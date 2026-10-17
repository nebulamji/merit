// The REAL dashboard bundle (ui/dashboard.js) running in a simulated browser, with a fake native layer and a throwaway signing key.
// Every scenario a person can hit with the Sign button is an assertion here. Nothing real is read or written; the network is faked.
import { test, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex } from '@noble/hashes/utils';
import { verifySignature, merkleRoot } from '@merit/attest';

const ui = (f: string) => new URL('../ui/' + f, import.meta.url);
let html = '', bundle = '';
beforeAll(() => { html = readFileSync(ui('index.html'), 'utf8').replace(/<script src="dashboard.js"><\/script>/, ''); bundle = readFileSync(ui('dashboard.js'), 'utf8'); });

let s0 = 1; const rnd = () => ((s0 = (s0 * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const session = (n: number, seed = 1) => { s0 = seed * 7919; let t = 0; const C = ['char', 'char', 'char', 'space', 'upper', 'back', 'punct', 'enter']; const o: string[] = []; for (let i = 0; i < n; i++) { t += 40 + Math.floor(rnd() * 250); o.push(JSON.stringify({ seq: i, t, k: C[Math.floor(rnd() * C.length)] })); } return o.join('\n') + '\n'; };

interface World { files: Map<string, Uint8Array>; calls: string[]; written: { name: string; priv: boolean }[]; opts: { native?: boolean; failKey?: boolean } }
async function open(files: Record<string, string>, opts: World['opts'] = { native: true }) {
  const sk = ed25519.utils.randomPrivateKey(), pub = bytesToHex(ed25519.getPublicKey(sk));
  const w: World = { files: new Map(Object.entries(files).map(([k, v]) => [k, new TextEncoder().encode(v)])), calls: [], written: [], opts };
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const win: any = dom.window; const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
  const errors: string[] = []; win.addEventListener('error', (e: any) => errors.push(String(e.message)));
  const invoke = async (cmd: string, a: any = {}) => {
    w.calls.push(cmd);
    switch (cmd) {
      case 'public_key': if (opts.failKey) throw new Error('keychain locked'); return pub;
      case 'sign': return bytesToHex(ed25519.sign(Buffer.from(a.payloadB64, 'base64'), sk));
      case 'list_files': return [...w.files.keys()].filter((k) => k.startsWith(a.dir + '/')).map((k) => k.slice(a.dir.length + 1));
      case 'read_file': { const f = w.files.get(a.name); if (!f) throw new Error('not found'); return b64(f); }
      case 'file_size': { const f = w.files.get(a.name); if (!f) throw new Error('not found'); return f.length; }
      case 'write_file': w.files.set(a.name, new Uint8Array(Buffer.from(a.dataB64, 'base64'))); w.written.push({ name: a.name, priv: !!a.private }); return null;
      case 'events_root': if (!opts.native) throw new Error('native unavailable'); return merkleRoot(a.keys, a.secretHex);
      case 'capture_health': return { listener_failed: false };
      case 'add_app': w.calls.push('add_app:' + a.name); return [a.name];
      case 'open_input_settings': return null;
      case 'delete_empty_session': { w.files.delete(`${a.base}.jsonl`); w.files.delete(`${a.base}.meta.json`); return null; }
      case 'take_to_sign': return []; case 'recording_status': return false; case 'log': return null;
      case 'http': { const u = new URL(a.url); if (a.method === 'POST') return { status: 500, body_b64: '' }; return { status: u.pathname === '/api/requests' ? 200 : 404, body_b64: b64(new TextEncoder().encode('[]')) }; }
      default: throw new Error('unknown command ' + cmd);
    }
  };
  win.__TAURI__ = { core: { invoke }, event: { listen: async () => () => {} } };
  win.eval(bundle);
  const q = (s: string) => win.document.querySelector(s) as HTMLElement, qa = (s: string) => [...win.document.querySelectorAll(s)] as HTMLElement[];
  const until = async (f: () => unknown, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return; await new Promise((r) => setTimeout(r, 25)); } throw new Error('timed out; note: ' + q('#note').textContent); };
  await until(() => !q('#list').textContent!.includes('Loading'));
  const card = (id: string) => qa('.card').find((c) => c.querySelector('b')?.textContent?.includes(id))!;
  const press = (id: string, label: string) => { const b = [...card(id).querySelectorAll('button')].find((x) => x.textContent === label) as HTMLButtonElement; if (!b) throw new Error(`no "${label}" button on ${id}`); b.click(); };
  return { w, q, qa, until, card, press, errors, close: () => dom.window.close() };
}
const cert = (w: World, base: string) => JSON.parse(new TextDecoder().decode(w.files.get(`sessions/${base}.cert.json`)!));

test('empty session: says why, with the right fix, and the fix works', async () => {
  const meta = JSON.stringify({ seen: 412, recorded: 0, apps_skipped: [{ app: 'Claude', keys: 300 }, { app: 'Messages', keys: 80 }] });
  const d = await open({ 'sessions/a-desktop.jsonl': '', 'sessions/a-desktop.meta.json': meta });
  expect(d.card('a-desktop').textContent).toMatch(/recorded nothing/); expect([...d.card('a-desktop').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Why?', 'Remove']);   // no Sign button that can do nothing
  d.press('a-desktop', 'Why?'); await d.until(() => !d.q('#why').hidden);
  expect(d.q('#why').textContent).toMatch(/Merit saw 412 key presses and recorded none/); expect(d.q('#why').textContent).toMatch(/Claude \(300\), Messages \(80\)/);
  const fix = [...d.q('#why').querySelectorAll('button')].find((b) => b.textContent === 'Measure Claude') as HTMLButtonElement; fix.click(); await d.until(() => d.w.calls.includes('add_app:Claude') && /Claude is on your list/.test(d.q('#note').textContent || '')); expect(d.errors).toEqual([]); d.close();
});

test('empty session: no notes, and 0 keys seen, each give their own plain advice', async () => {
  const d = await open({ 'sessions/b-desktop.jsonl': '', 'sessions/c-desktop.jsonl': '', 'sessions/c-desktop.meta.json': JSON.stringify({ seen: 0 }) });
  d.press('b-desktop', 'Why?'); await d.until(() => /Nothing was recorded/.test(d.q('#why').textContent || '')); expect(d.q('#why').textContent).toMatch(/Input Monitoring/);
  d.press('c-desktop', 'Why?'); await d.until(() => /no key presses at all/.test(d.q('#why').textContent || '')); expect([...d.q('#why').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Open Input Monitoring settings']); d.close();
});

test('empty session can be removed; a session with keys cannot be mistaken for empty', async () => {
  const d = await open({ 'sessions/e-desktop.jsonl': '', 'sessions/f-desktop.jsonl': session(20) });
  d.press('e-desktop', 'Remove'); await d.until(() => !d.qa('.card').some((c) => c.textContent!.includes('e-desktop'))); expect(d.card('f-desktop').textContent).toMatch(/not signed/); expect([...d.card('f-desktop').querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Sign']); d.close();
});

test('SIGN, normal session: a valid certificate is written, the secret is private, and anchoring failing is reported without losing the signature', async () => {
  const d = await open({ 'sessions/n-desktop.jsonl': session(2000, 4) }); d.press('n-desktop', 'Sign');
  await d.until(() => d.w.files.has('sessions/n-desktop.cert.json') && /Anchoring failed|submitted to Bitcoin/.test(d.q('#note').textContent || ''));
  const c = cert(d.w, 'n-desktop'); expect(verifySignature(c)).toBe(true); expect(c.event_count).toBe(2000); expect(c.id).toMatch(/^merit_/);
  expect(d.w.written.find((x) => x.name.endsWith('.secret'))!.priv).toBe(true); expect(d.q('#note').textContent).toMatch(/Signed\. Anchoring failed .*it will retry/); expect(d.errors).toEqual([]); d.close();
});

test('SIGN, long session (60,000 key presses): works with the native commitment AND with the in-browser fallback, and the certificates are valid either way', async () => {
  const raw = session(60000, 5);
  for (const native of [true, false]) {
    const t0 = Date.now(); const d = await open({ 'sessions/l-desktop.jsonl': raw }, { native }); d.press('l-desktop', 'Sign');
    await d.until(() => d.w.files.has('sessions/l-desktop.cert.json'), 90000); const c = cert(d.w, 'l-desktop');
    expect(verifySignature(c)).toBe(true); expect(c.event_count).toBe(60000); expect(d.w.calls.includes('events_root')).toBe(true);
    console.log(`SIGN 60,000 events, ${native ? 'stubbed native call (uses the JS algorithm here, so not a speed measure)' : 'in-browser fallback path'}: ${Date.now() - t0} ms`); d.close();
  }
}, 240000);

test('SIGN, damaged files: a bad line in the middle is refused plainly and writes nothing; a crash-truncated last line is tolerated', async () => {
  const good = session(10, 6).trim().split('\n');
  const d = await open({ 'sessions/x-desktop.jsonl': good.slice(0, 3).join('\n') + '\nNOT JSON\n' + good.slice(3).join('\n') + '\n', 'sessions/y-desktop.jsonl': session(300, 8) + '{"seq":300,"t":99999,"k":"ch' });
  d.press('x-desktop', 'Sign'); await d.until(() => /damaged/.test(d.q('#note').textContent || '')); expect(d.q('#note').textContent).toMatch(/line 4 is not readable/); expect(d.w.files.has('sessions/x-desktop.cert.json')).toBe(false);
  d.press('y-desktop', 'Sign'); await d.until(() => d.w.files.has('sessions/y-desktop.cert.json')); expect(cert(d.w, 'y-desktop').event_count).toBe(300); expect(verifySignature(cert(d.w, 'y-desktop'))).toBe(true); d.close();
});

test('SIGN, the privacy rule: a session containing anything but key types is refused and nothing is written', async () => {
  const d = await open({ 'sessions/p-desktop.jsonl': '{"seq":0,"t":5,"k":"char","text":"hello"}\n{"seq":1,"t":9,"k":"char"}\n' }); d.press('p-desktop', 'Sign');
  await d.until(() => /Refused to sign/.test(d.q('#note').textContent || '')); expect(d.q('#note').textContent).toMatch(/unexpected field "text"/); expect(d.w.files.has('sessions/p-desktop.cert.json')).toBe(false); d.close();
});

test('startup resilience: if reading the key fails, every control is still wired and the person is told why', async () => {
  const d = await open({ 'sessions/z-desktop.jsonl': session(10) }, { native: true, failKey: true });
  await d.until(() => /Could not read your key/.test(d.q('#note').textContent || '')); (d.q('#recognize') as HTMLButtonElement).click(); await d.until(() => /Paste a certificate/.test(d.q('#note').textContent || ''));
  (d.q('#set-wallet') as HTMLButtonElement).click(); await d.until(() => /not a wallet address/.test(d.q('#note').textContent || '')); d.close();
});
