// Dashboard: builds certificates with the same code as the CLI and the website, asks the native side to
// sign (the key never enters this page), anchors and upgrades in Bitcoin, and inscribes in the Book.
import { attestationId, canonicalJSON, signingPayload, type KeyEvent, type MeritAttestation } from '@merit/spec';
import { attestationBody, newSessionSecret, verifySignature, recognitionBody, verifyRecognition, bodyOf } from '@merit/attest';
import { deriveKeyMetrics, privacyLint } from '@merit/capture';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { stampDigest, upgradeOts, confirmBitcoin, readOts } from '../../../packages/verify/src/ots';
import { workFloor, FOUNDER } from '../../site/src/qualify';
import { parseSession, signKeys } from './signing';
import { explainEmpty, type Meta } from './diagnose';

const { invoke } = (window as any).__TAURI__.core;
const { listen } = (window as any).__TAURI__.event;
const BOOK = 'https://merit.artofficial.computer';

const b64 = (u: Uint8Array) => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const text = (u: Uint8Array) => new TextDecoder().decode(u);
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const read = async (name: string) => { try { return unb64(await invoke('read_file', { name })); } catch { return null; } };
const write = (name: string, data: Uint8Array, priv = false) => invoke('write_file', { name, dataB64: b64(data), private: priv });
async function http(method: 'GET' | 'POST', url: string, body?: Uint8Array, contentType?: string) {
  const r = await invoke('http', { method, url, bodyB64: body ? b64(body) : null, contentType: contentType ?? null });
  return { status: r.status as number, body: unb64(r.body_b64) };
}
const post = async (url: string, body: Uint8Array) => { const r = await http('POST', url, body); return r.status === 200 ? r.body : null; };
const get = async (url: string) => { const r = await http('GET', url); return r.status === 200 ? r.body : null; };
const blockRoot = async (h: number) => {
  for (const base of ['https://mempool.space/api', 'https://blockstream.info/api']) {
    try {
      const hash = text((await http('GET', `${base}/block-height/${h}`)).body).trim();
      const blk = JSON.parse(text((await http('GET', `${base}/block/${hash}`)).body));
      if (blk.merkle_root) return blk.merkle_root as string;
    } catch { /* next */ }
  }
  throw new Error('no explorer');
};
const anchorDigest = (c: MeritAttestation) => sha256(utf8ToBytes(canonicalJSON(c)));

function note(msg: string, bad = false) { const n = $('#note'); n.textContent = msg; n.dataset.bad = bad ? '1' : ''; }

/** Sign a recorded session: lint, derive, build, sign natively, write, then anchor. */
async function signSession(jsonl: string) {
  const base = jsonl.replace(/\.jsonl$/, '');
  if (await read(`${base}.cert.json`)) return note('That session is already signed.');
  const raw = await read(jsonl);
  if (!raw) return note(`Could not read ${jsonl}`, true);
  const p = parseSession(text(raw));
  if (p.status === 'empty') { await showWhyEmpty(base); return; }
  if (p.status === 'corrupt') return note(`This session file is damaged (${p.reason}), so it was not signed.`, true);
  if (p.status === 'refused') return note(`Refused to sign: ${p.reason}.`, true);
  // Long sessions: say what is happening, let the window paint, and do the heavy commitment natively (the browser path is the fallback).
  note(`Signing ${p.keys.length.toLocaleString('en-US')} key presses…`); await new Promise((res) => setTimeout(res, 30));
  const secret = newSessionSecret();
  let eventsRoot: string | undefined;
  try { eventsRoot = await invoke('events_root', { keys: p.keys.map((k: any) => ({ seq: k.seq, t: k.t, k: k.k, ...(k.n !== undefined ? { n: k.n } : {}) })), secretHex: secret }) as string; } catch { eventsRoot = undefined; }
  const r = await signKeys(p.keys, await invoke('public_key'), async (payload) => invoke('sign', { payloadB64: b64(payload) }), { secret, eventsRoot });
  if (!r.ok) return note(`Not signed: ${r.error}.`, true);
  const { cert } = r;
  await write(`${base}.cert.json`, utf8ToBytes(JSON.stringify(cert, null, 2)));
  await write(`${base}.secret`, utf8ToBytes(secret), true);
  note(`Signed ${cert.id}. Anchoring to Bitcoin…`);
  try {
    const ots = await stampDigest(anchorDigest(cert), post, crypto.getRandomValues(new Uint8Array(16)));
    await write(`${base}.cert.json.ots`, ots);
    note(`Signed and submitted to Bitcoin. It confirms in a few hours; this window checks for you.`);
  } catch (e) { note(`Signed. Anchoring failed (${(e as Error).message}); it will retry.`, true); }
  await render();
}

type Row = { base: string; cert: MeritAttestation | null; ots: Uint8Array | null; height: number | null; pending: boolean; empty?: boolean };

async function rows(): Promise<Row[]> {
  const files: string[] = await invoke('list_files', { dir: 'sessions' });
  const out: Row[] = [];
  for (const f of files.filter((x) => x.endsWith('.jsonl')).reverse()) {
    const base = `sessions/${f.replace(/\.jsonl$/, '')}`;
    const c = await read(`${base}.cert.json`); const o = await read(`${base}.cert.json.ots`);
    const cert = c ? JSON.parse(text(c)) as MeritAttestation : null;
    let height: number | null = null, pending = false;
    if (o) { try { const p = readOts(o); const b = p.attestations.find((a) => a.kind === 'bitcoin') as any; height = b?.height ?? null; pending = !b && p.attestations.some((a) => a.kind === 'pending'); } catch { /* unreadable */ } }
    let empty = false; if (!cert) { try { empty = (await invoke('file_size', { name: `${base}.jsonl` })) === 0; } catch { empty = false; } }
    out.push({ base, cert, ots: o, height, pending, empty });
  }
  return out;
}

/** Retry anchoring for signed sessions without a proof, and upgrade pending proofs. */
async function maintain(list: Row[]) {
  let changed = false;
  for (const r of list) {
    if (r.cert && !r.ots) {
      try { await write(`${r.base}.cert.json.ots`, await stampDigest(anchorDigest(r.cert), post, crypto.getRandomValues(new Uint8Array(16)))); changed = true; } catch { /* offline */ }
    } else if (r.cert && r.ots && r.pending) {
      try { const u = await upgradeOts(r.ots, get); if (u.changed && readOts(u.ots).attestations.some((a) => a.kind === 'bitcoin')) { await write(`${r.base}.cert.json.ots`, u.ots); changed = true; } } catch { /* not yet */ }
    }
  }
  if (changed) await render();
}

const recognitionFor = async (certId: string) => { const r = await read(`recognitions/${certId}.recognition.json`); return r ? JSON.parse(text(r)) : undefined; };

async function inscribe(r: Row, list: Row[]) {
  if (!r.cert || !r.ots) return;
  note('Checking the anchor against Bitcoin…');
  const ok = await confirmBitcoin(bytesToHex(anchorDigest(r.cert)), r.ots, blockRoot);
  if (!ok.ok) return note(`Not ready: ${ok.reason}`, true);
  const me = r.cert.author.public_key;
  const recognition = await recognitionFor(r.cert.id);
  const history = recognition ? [] : list.filter((x) => x !== r && x.cert?.author.public_key === me && x.height && x.ots).map((x) => ({ certificate: x.cert, ots: b64(x.ots!) }));
  note('Inscribing…');
  const res = await http('POST', `${BOOK}/api/inscribe`, utf8ToBytes(JSON.stringify({ certificate: r.cert, ots: b64(r.ots), recognition, history, consent: true })), 'application/json');
  let j: any = {}; try { j = JSON.parse(text(res.body)); } catch { /* */ }
  note(j.ok ? (j.already ? `Already in the Book as No. ${j.seq}.` : `Inscribed as No. ${j.seq}.`) : `Not inscribed: ${j.reason ?? res.status}.`, !j.ok);
}

/** An empty session explains itself: what Merit saw, why none of it was kept, and a button for the fix. */
async function showWhyEmpty(base: string) {
  let meta: Meta | null = null; const m = await read(`${base}.meta.json`); if (m) { try { meta = JSON.parse(text(m)); } catch { /* */ } }
  let health: any = {}; try { health = await invoke('capture_health'); } catch { /* */ }
  const ex = explainEmpty(meta, health), box = $('#why'); box.hidden = false; box.innerHTML = '';
  const h = document.createElement('b'); h.textContent = ex.title; box.append(h);
  for (const line of ex.lines) { const p = document.createElement('p'); p.className = 'sub'; p.textContent = line; box.append(p); }
  const row = document.createElement('div'); row.className = 'row';
  for (const f of ex.fixes) {
    const b = document.createElement('button');
    if (f.kind === 'input-settings') { b.textContent = 'Open Input Monitoring settings'; b.onclick = async () => { try { await invoke('open_input_settings'); } catch (e) { note(String((e as Error).message ?? e), true); } }; }
    else { b.textContent = `Measure ${f.app}`; b.onclick = async () => { b.disabled = true; try { await invoke('add_app', { name: f.app }); note(`${f.app} is on your list. It applies to the next session you start.`); } catch (e) { note(String((e as Error).message ?? e), true); } }; }
    row.append(b);
  }
  box.append(row); note(ex.title, true);
}

const mins = (ms: number) => Math.max(1, Math.round(ms / 60000));

/** Certificates waiting for someone in the Book to recognize them. Recognizing signs natively and inscribes. */
async function renderWaiting() {
  const el = $('#waiting'); el.innerHTML = '';
  let list: any[] = [];
  try { list = JSON.parse(text((await http('GET', `${BOOK}/api/requests`)).body)); } catch { return; }
  const me: string = await invoke('public_key');
  list = list.filter((w) => !me.startsWith(w.key));
  $('#waiting-wrap').hidden = !list.length;
  for (const w of list) {
    const s = w.shape;
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<div class="row"><b class="mono">${esc(w.id)}</b><span class="k">asked ${esc(String(w.requested_utc).slice(0, 10))}</span></div>
      <div class="k">${s.typed} typed · ${s.pasted} pasted · ${s.deletions} deletions · ${s.forgiveness} slips forgiven · ${mins(s.active_s * 1000)} active min · key ${esc(w.key)}…</div>
      <div class="row"><span class="k">Recognize only work you have reason to stand behind; your recognitions are public.</span><button>Recognize</button></div>`;
    card.querySelector('button')!.onclick = async (e) => {
      (e.target as HTMLButtonElement).disabled = true;
      const body = recognitionBody(me, w.id);
      const signature: string = await invoke('sign', { payloadB64: b64(utf8ToBytes(canonicalJSON(body))) });
      const res = await http('POST', `${BOOK}/api/recognize`, utf8ToBytes(JSON.stringify({ recognition: { ...body, signature } })), 'application/json');
      let j: any = {}; try { j = JSON.parse(text(res.body)); } catch { /* */ }
      note(j.ok ? `Recognized. It is now Mark ${j.seq} in the Book.` : `Not recognized: ${j.reason ?? res.status}.`, !j.ok);
      await renderWaiting();
    };
    el.append(card);
  }
}

async function render() {
  const list = await rows();
  const el = $('#list');
  if (!list.length) { el.innerHTML = '<p class="sub">No sessions yet. In the menu bar: Measure integrity, write, then Stop &amp; sign.</p>'; return list; }
  el.innerHTML = '';
  for (const r of list) {
    const card = document.createElement('div'); card.className = 'card';
    if (!r.cert && r.empty) {
      card.innerHTML = `<div class="row"><b>${esc(r.base.split('/')[1])}</b><span class="pend">recorded nothing</span></div><div class="row"><span class="k">There is nothing to sign here.</span><span><button class="why">Why?</button> <button class="rm">Remove</button></span></div>`;
      (card.querySelector('.why') as HTMLButtonElement).onclick = () => showWhyEmpty(r.base);
      (card.querySelector('.rm') as HTMLButtonElement).onclick = async () => { try { await invoke('delete_empty_session', { base: r.base }); await render(); } catch (e) { note(String((e as Error).message ?? e), true); } };
    } else if (!r.cert) {
      card.innerHTML = `<div class="row"><b>${esc(r.base.split('/')[1])}</b><span class="pend">not signed</span></div><div class="row"><button>Sign</button></div>`;
      card.querySelector('button')!.onclick = () => signSession(`${r.base}.jsonl`);
    } else {
      const m = r.cert.metrics as any;
      const status = r.height ? `<span class="ok">anchored · block ${r.height}</span>` : r.ots ? '<span class="pend">anchoring (a few hours)</span>' : '<span class="pend">not anchored yet</span>';
      const floor = workFloor(r.cert);
      card.innerHTML = `<div class="row"><b class="mono">${esc(r.cert.id)}</b>${status}</div>
        <div class="row stats">
          <div><div class="k">active</div><div class="v">${mins(m.active_ms)} min</div></div>
          <div><div class="k">typed</div><div class="v">${m.chars_typed}</div></div>
          <div><div class="k">pasted</div><div class="v">${m.chars_pasted}</div></div>
          <div><div class="k">deletions</div><div class="v">${m.corrections.deletions}</div></div>
          <div><div class="k">slips forgiven</div><div class="v">${m.forgiveness}</div></div>
        </div>
        <div class="k">${esc(r.cert.created_utc)} · signed by <span class="mono">${esc(r.cert.author.public_key.slice(0, 16))}…</span></div>`;
      if (r.height && !floor && !(await recognitionFor(r.cert.id)) && r.cert.author.public_key !== FOUNDER) {
        const ask = document.createElement('div'); ask.className = 'row';
        ask.innerHTML = `<label class="consent"><input type="checkbox"> Ask for recognition: show this certificate's counts, id and key on the Book's waiting list (up to 30 days)</label><button disabled>Ask</button>`;
        const cb = ask.querySelector('input')!, btn = ask.querySelector('button')!;
        cb.onchange = () => (btn.disabled = !cb.checked);
        btn.onclick = async () => {
          btn.disabled = true;
          const res = await http('POST', `${BOOK}/api/request`, utf8ToBytes(JSON.stringify({ certificate: r.cert, ots: b64(r.ots!), consent: true })), 'application/json');
          let j: any = {}; try { j = JSON.parse(text(res.body)); } catch { /* */ }
          note(j.ok ? 'On the waiting list. When someone recognizes it, it is inscribed automatically.' : `Not added: ${j.reason ?? res.status}.`, !j.ok);
        };
        card.append(ask);
      }
      if (r.height && !floor) {
        const row = document.createElement('div'); row.className = 'row';
        row.innerHTML = `<label class="consent"><input type="checkbox"> Publish this certificate's counts, id and public key in the Book, permanently</label><button disabled>Inscribe</button>`;
        const cb = row.querySelector('input')!, btn = row.querySelector('button')!;
        cb.onchange = () => (btn.disabled = !cb.checked);
        btn.onclick = () => { btn.disabled = true; inscribe(r, list); };
        card.append(row);
      } else if (r.height && floor) {
        const p = document.createElement('div'); p.className = 'k'; p.textContent = `Not eligible for the Book: needs ${floor}.`; card.append(p);
      }
    }
    el.append(card);
  }
  return list;
}

// Recognize someone else's certificate, or store a recognition you received.
async function recognizeOther() {
  const box = $('#paste') as HTMLTextAreaElement; let c: any;
  try { c = JSON.parse(box.value); } catch { return note('Paste a certificate (JSON).', true); }
  if (c?.schema === 'merit-recognition/0.1') {
    if (!verifyRecognition(c, c.certificate_id)) return note('That recognition does not verify.', true);
    await write(`recognitions/${c.certificate_id}.recognition.json`, utf8ToBytes(JSON.stringify(c, null, 2)));
    box.value = ''; return note('Recognition saved. Inscribe that certificate from its card.');
  }
  let valid = false; try { valid = c.id === attestationId(bodyOf(c)) && verifySignature(c); } catch { /* */ }
  if (!valid) return note('That certificate does not verify.', true);
  const me: string = await invoke('public_key');
  if (c.author.public_key === me) return note('You cannot recognize your own certificate.', true);
  const body = recognitionBody(me, c.id);
  const signature: string = await invoke('sign', { payloadB64: b64(utf8ToBytes(canonicalJSON(body))) });
  const rec = { ...body, signature };
  if (!verifyRecognition(rec as any, c.id)) return note('Recognition check failed.', true);
  const out = JSON.stringify(rec, null, 2);
  await write(`recognitions/given-${c.id}.json`, utf8ToBytes(out));
  box.value = out; box.select();
  note('Recognition signed. Send the text above to its author; it is also saved in ~/.merit/recognitions.');
}

window.addEventListener('error', (e) => { invoke('log', { msg: `error: ${e.message}` }); note(`Something went wrong: ${e.message}`, true); });
window.addEventListener('unhandledrejection', (e: any) => { invoke('log', { msg: `rejection: ${e.reason?.message ?? e.reason}` }); note(`Something went wrong: ${e.reason?.message ?? e.reason}`, true); });

let draining = false;
async function drain() {
  if (draining) return; draining = true;
  try { for (const name of await invoke('take_to_sign') as string[]) await signSession(`sessions/${name}`); } finally { draining = false; }
}

/** Bind a wallet to your Merit key: your share of Portfolio sales goes there, and it may own your marks. */
async function setWallet() {
  const address = ($('#wallet') as HTMLInputElement).value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return note('That is not a wallet address (0x… 40 characters).', true);
  const me: string = await invoke('public_key');
  const body = { schema: 'merit-wallet/0.1', public_key: me, address, created_utc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
  const signature: string = await invoke('sign', { payloadB64: b64(utf8ToBytes(canonicalJSON(body))) });
  const res = await http('POST', `${BOOK}/api/wallet`, utf8ToBytes(JSON.stringify({ binding: { ...body, signature } })), 'application/json');
  let j: any = {}; try { j = JSON.parse(text(res.body)); } catch { /* */ }
  note(j.ok ? `Wallet set. Your share of every Portfolio goes to ${j.address}; own your marks at merit.artofficial.computer/collect.` : `Not set: ${j.reason ?? res.status}.`, !j.ok);
}

async function main() {
  // Bind every control FIRST, before anything that can fail or wait: a slow or failing startup must never leave the buttons dead.
  $('#set-wallet').onclick = setWallet;
  $('#recognize').onclick = recognizeOther;
  let me = '';
  try { me = await invoke('public_key') as string; $('#me').textContent = `Your key: ${me.slice(0, 16)}…`; } catch (e) { note(`Could not read your key: ${(e as Error).message ?? e}`, true); }
  try { await drain(); } catch (e) { note(`Signing failed: ${(e as Error).message ?? e}`, true); }
  renderWaiting().catch(() => {});
  try { await listen('sign-queued', () => drain().catch((e) => note(`Signing failed: ${(e as Error).message ?? e}`, true))); } catch (e) { invoke('log', { msg: `listen failed: ${(e as Error).message ?? e}` }); }
  let list: Row[] = []; try { list = await render(); } catch (e) { note(`Could not list your sessions: ${(e as Error).message ?? e}`, true); }
  maintain(list).catch(() => {});
  setInterval(async () => { try { maintain(await render()); renderWaiting(); } catch { /* try again next time */ } }, 10 * 60_000);
}
main();
