import { test, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { hexToBytes } from '@noble/hashes/utils';
import { generateKeyPair, verifySignature } from '@merit/attest';
import type { KeyEvent } from '@merit/spec';
import { parseSession, signKeys } from '../src/signing';
import { explainEmpty } from '../src/diagnose';

// ---- fixtures: sessions in EXACTLY the shape the Rust recorder writes (one JSON object per line; `n` is omitted)
let s0 = 12345; const rnd = () => ((s0 = (s0 * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const CLASSES = ['char', 'char', 'char', 'char', 'space', 'upper', 'digit', 'punct', 'back', 'enter', 'nav', 'select', 'undo', 'paste', 'del', 'cmd'] as const;
function session(n: number, seed = 1): string {
  s0 = seed * 7919; let t = 0; const out: string[] = [];
  for (let i = 0; i < n; i++) { t += 40 + Math.floor(rnd() * 250) + (rnd() < 0.01 ? 2500 : 0); out.push(JSON.stringify({ seq: i, t, k: CLASSES[Math.floor(rnd() * CLASSES.length)] })); }
  return out.join('\n') + '\n';
}
const kp = generateKeyPair();
const signer = async (payload: Uint8Array) => Buffer.from(ed25519.sign(payload, hexToBytes(kp.privateKey))).toString('hex');
const ready = (raw: string) => { const p = parseSession(raw); if (p.status !== 'ready') throw new Error('not ready: ' + JSON.stringify(p)); return p.keys; };

test('what the recorder actually writes parses, signs, and verifies', async () => {
  const keys = ready(session(400));
  const r = await signKeys(keys, kp.publicKey, signer);
  expect(r.ok).toBe(true); if (!r.ok) return;
  expect(r.cert.id).toMatch(/^merit_[0-9a-f]{20}$/); expect(r.cert.event_count).toBe(400); expect(r.cert.author.public_key).toBe(kp.publicKey);
  expect(verifySignature(r.cert)).toBe(true);
});

test('deterministic: the same events, secret and key always give the same certificate, byte for byte', async () => {
  const keys = ready(session(300, 3)), secret = 'ab'.repeat(32); const seen = new Set<string>();
  for (let i = 0; i < 25; i++) { const r = await signKeys(keys, kp.publicKey, signer, { secret, createdUtc: '2026-10-17T12:00:00Z' }); if (!r.ok) throw new Error(r.error); seen.add(JSON.stringify(r.cert)); }
  expect(seen.size).toBe(1);
});

test('different secrets give different ids (sessions cannot be linked by their commitments)', async () => {
  const keys = ready(session(200, 4)); const a = await signKeys(keys, kp.publicKey, signer), b = await signKeys(keys, kp.publicKey, signer);
  if (!a.ok || !b.ok) throw new Error('sign'); expect(a.cert.id).not.toBe(b.cert.id); expect(a.cert.events_root).not.toBe(b.cert.events_root);
});

test('tampering with ANY part of a signed certificate is caught', async () => {
  const keys = ready(session(250, 5)); const r = await signKeys(keys, kp.publicKey, signer); if (!r.ok) throw new Error('sign');
  const c = r.cert as any, mutate: [string, (x: any) => void][] = [
    ['chars_typed', (x) => (x.metrics.chars_typed += 1)], ['deletions', (x) => (x.metrics.corrections.deletions += 1)], ['active_ms', (x) => (x.metrics.active_ms += 1)], ['forgiveness', (x) => (x.metrics.forgiveness = 1 - x.metrics.forgiveness)],
    ['event_count', (x) => (x.event_count += 1)], ['events_root', (x) => (x.events_root = '00' + x.events_root.slice(2))], ['created_utc', (x) => (x.created_utc = '2020-01-01T00:00:00Z')], ['surface', (x) => (x.surface = 'x')],
    ['author', (x) => (x.author.public_key = kp.publicKey.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')))], ['signature', (x) => (x.signature = x.signature.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')))], ['id', (x) => (x.id = 'merit_' + '0'.repeat(20))],
  ];
  for (const [name, f] of mutate) { const copy = JSON.parse(JSON.stringify(c)); f(copy); const ok = (() => { try { return copy.id === (require('@merit/spec') as any).attestationId({ ...copy, id: undefined, signature: undefined }) && verifySignature(copy); } catch { return false; } })(); expect(ok, name).toBe(false); }
});

test('parsing: every kind of damaged or odd file gets the right, plain verdict', () => {
  const good = session(5, 9).trim().split('\n');
  const cases: [string, string, string][] = [
    ['empty file', '', 'empty'], ['only blank lines', '\n\n  \n', 'empty'],
    ['one valid event', good[0] + '\n', 'ready'], ['a half-written last line is ignored', good.slice(0, 4).join('\n') + '\n{"seq":4,"t":99', 'ready'],
    ['no trailing newline', good.join('\n'), 'ready'], ['null paste length is treated as absent', '{"seq":0,"t":5,"k":"paste","n":null}\n', 'ready'],
    ['garbage in the middle', good[0] + '\nNOT JSON\n' + good[1] + '\n', 'corrupt'], ['a lone unreadable line', 'oops\n', 'corrupt'],
    ['time goes backwards', '{"seq":0,"t":50,"k":"char"}\n{"seq":1,"t":10,"k":"char"}\n', 'corrupt'], ['negative sequence', '{"seq":-1,"t":5,"k":"char"}\n', 'corrupt'],
    ['non-numeric time', '{"seq":0,"t":"soon","k":"char"}\n', 'corrupt'], ['unknown key type', '{"seq":0,"t":5,"k":"banana"}\n', 'refused'],
    ['extra field (the privacy rule): text', '{"seq":0,"t":5,"k":"char","text":"hello"}\n', 'refused'], ['extra field: character', '{"seq":0,"t":5,"k":"char","key":"a"}\n', 'refused'],
  ];
  for (const [name, raw, want] of cases) expect(parseSession(raw).status, name).toBe(want);
  const tail = parseSession(good.slice(0, 4).join('\n') + '\n{"seq":4,"t":99'); expect(tail.status === 'ready' && tail.ignoredTail).toBe(true); expect(tail.status === 'ready' && tail.keys.length).toBe(4);
});

test('the certificate carries counts, never the keys: no event list, no key classes, no timing vectors', async () => {
  const keys = ready(session(300, 6)); const r = await signKeys(keys, kp.publicKey, signer); if (!r.ok) throw new Error('sign');
  const j = JSON.stringify(r.cert); expect(j).not.toMatch(/"k":/); expect(j).not.toMatch(/"seq":/); expect(Object.keys(r.cert).sort()).toEqual(['author', 'created_utc', 'doc_sha256', 'event_count', 'events_root', 'id', 'metrics', 'schema', 'signature', 'surface']);
});

test('a failing signer yields a plain error and never a half-written certificate', async () => {
  const keys = ready(session(50, 7));
  const bad = await signKeys(keys, kp.publicKey, async () => { throw new Error('keychain locked'); }); expect(bad.ok).toBe(false); expect(!bad.ok && bad.error).toMatch(/keychain locked/);
  const wrong = await signKeys(keys, kp.publicKey, async () => 'ab'.repeat(64)); expect(wrong.ok).toBe(false); expect(!wrong.ok && wrong.error).toMatch(/signature/);
  const other = generateKeyPair(); const mismatched = await signKeys(keys, kp.publicKey, async (p) => Buffer.from(ed25519.sign(p, hexToBytes(other.privateKey))).toString('hex')); expect(mismatched.ok).toBe(false);
});

test('EVAL LOOP: 300 generated sessions (1 to 6000 events): every one signs, verifies, and changes its id when a single event changes', async () => {
  let signed = 0, totalEvents = 0; const secret = 'cd'.repeat(32);
  for (let i = 0; i < 300; i++) {
    const n = 1 + Math.floor((i * i * 6000) / (299 * 299)), raw = session(n, 100 + i), keys = ready(raw);
    const r = await signKeys(keys, kp.publicKey, signer, { secret }); if (!r.ok) throw new Error(`session ${i} (${n} events): ${r.error}`);
    expect(verifySignature(r.cert)).toBe(true); expect(r.cert.event_count).toBe(n); signed++; totalEvents += n;
    if (i % 25 === 0) { const alt = keys.map((k, j) => (j === Math.floor(n / 2) ? ({ ...k, k: k.k === 'char' ? 'back' : 'char' } as KeyEvent) : k)); const r2 = await signKeys(alt, kp.publicKey, signer, { secret }); if (!r2.ok) throw new Error('alt'); expect(r2.cert.id, `edit at session ${i}`).not.toBe(r.cert.id); }
  }
  console.log(`EVAL LOOP: ${signed}/300 sessions signed and verified (${totalEvents.toLocaleString()} events in total)`);
  expect(signed).toBe(300);
});

test('BENCHMARK (the in-browser fallback, on this slow laptop): 100,000 key presses; the native path is measured by cargo test', async () => {
  const keys = ready(session(100000, 77)); const t0 = performance.now();
  const r = await signKeys(keys, kp.publicKey, signer); const ms = Math.round(performance.now() - t0);
  console.log(`BENCHMARK (fallback path): 100,000 events signed in ${ms} ms`); expect(r.ok).toBe(true); expect(ms).toBeLessThan(30000);
});

test('a certificate built with a native root is identical to one built in the browser, when the roots agree', async () => {
  const keys = ready(session(500, 11)), secret = 'ef'.repeat(32), createdUtc = '2026-10-17T12:00:00Z';
  const { merkleRoot } = await import('@merit/attest');
  const viaBrowser = await signKeys(keys, kp.publicKey, signer, { secret, createdUtc });
  const viaNative = await signKeys(keys, kp.publicKey, signer, { secret, createdUtc, eventsRoot: merkleRoot(keys as any, secret) });
  if (!viaBrowser.ok || !viaNative.ok) throw new Error('sign'); expect(JSON.stringify(viaNative.cert)).toBe(JSON.stringify(viaBrowser.cert));
  const wrongRoot = await signKeys(keys, kp.publicKey, signer, { secret, createdUtc, eventsRoot: '00'.repeat(32) }); if (!wrongRoot.ok) throw new Error('sign'); expect(wrongRoot.cert.id).not.toBe(viaBrowser.cert.id);
});

test('diagnosis: an empty session says why, in plain words, with the right fix', () => {
  expect(explainEmpty(null, { listener_failed: true }).fixes).toEqual([{ kind: 'input-settings' }]);
  expect(explainEmpty({ seen: 0, listener_failed: true }).title).toMatch(/cannot see your keys/);
  expect(explainEmpty({ seen: 0 }).title).toMatch(/no key presses/); expect(explainEmpty({ seen: 0 }).fixes[0].kind).toBe('input-settings');
  const apps = explainEmpty({ seen: 412, apps_skipped: [{ app: 'Claude', keys: 300 }, { app: 'Messages', keys: 80 }, { app: 'Slack', keys: 20 }, { app: 'Figma', keys: 8 }, { app: 'Mail', keys: 4 }] });
  expect(apps.lines.join(' ')).toMatch(/Claude \(300\)/); expect(apps.fixes).toEqual([{ kind: 'add-app', app: 'Claude' }, { kind: 'add-app', app: 'Messages' }, { kind: 'add-app', app: 'Slack' }, { kind: 'add-app', app: 'Figma' }]);
  expect(explainEmpty({ seen: 50, secure_skipped: 50 }).lines.join(' ')).toMatch(/password field/);
  expect(explainEmpty({ seen: 9, app_unknown: 9 }).lines.join(' ')).toMatch(/could not tell which app/);
  expect(explainEmpty(null).title).toMatch(/Nothing was recorded/);
});
