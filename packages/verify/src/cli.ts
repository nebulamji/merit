#!/usr/bin/env node
/**
 * merit CLI
 *   merit verify <cert.json> [--ots cert.ots] [--text doc.txt] [--disclose d1.json ...] [--offline]
 *   merit stamp <cert.json>          writes <cert.json>.ots (pending)
 *   merit upgrade <cert.json.ots>    upgrades in place once a Bitcoin block has it
 *   merit certify <session.jsonl> [--text doc.txt] [--stamp]   sign a recorded session
 *   merit whoami                     print your public key (creates your key on first run)
 *   merit key migrate                move a key file into the system keychain (verified), then remove the file
 *   merit label <session.jsonl> composed|retyped|ai-retyped --participant <id> [--task t] [--manifest m]
 *   merit recognize <cert.json>       sign that you recognize someone's certificate (writes <cert>.recognition.json)
 *   merit calibrate [manifest.jsonl] [--threshold 0.5]   error rates of the active standard on labeled sessions
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, unlinkSync } from 'node:fs';
import { Entry } from '@napi-rs/keyring';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { appendFileSync } from 'node:fs';
import { calibrate, reportMarkdown, CAL_LABELS, type CalLabel, type Sample } from '@merit/calibrate';
import { verifyCertificate, stamp, upgrade } from './index';
import { generateKeyPair, newSessionSecret, buildAttestation, publicKeyOf, recognize, verifySignature, bodyOf } from '@merit/attest';
import { attestationId } from '@merit/spec';
import { deriveKeyMetrics } from '@merit/capture';
import type { KeyEvent } from '@merit/spec';

const HOME = join(homedir(), '.merit');

const KEY_CLASSES = new Set(['char', 'upper', 'digit', 'punct', 'space', 'enter', 'back', 'del', 'paste', 'nav', 'select', 'undo', 'cmd', 'review']);
const KEY_FIELDS = new Set(['seq', 't', 'k', 'n', 'app', 'decision', 'kind']);
const REVIEW_DECISIONS = new Set(['accept', 'keep']);
const REVIEW_KINDS = new Set(['space_before_punct', 'repeated_punct', 'multi_space', 'unbalanced_quote', 'doubled_quote']);

/** Device sessions may contain only key types and timing. Anything else is refused. */
export function privacyLint(keys: unknown[]): string[] {
  const out: string[] = [];
  keys.forEach((e, i) => {
    if (!e || typeof e !== 'object') { out.push(`event ${i}: not an object`); return; }
    for (const f of Object.keys(e)) if (!KEY_FIELDS.has(f)) out.push(`event ${i}: unexpected field "${f}"`);
    const ev = e as Record<string, unknown>;
    if (!KEY_CLASSES.has(String(ev.k))) out.push(`event ${i}: unknown key type "${String(ev.k).slice(0, 12)}"`);
    if (ev.n !== undefined && typeof ev.n !== 'number') out.push(`event ${i}: paste length must be a number`);
    if (ev.app !== undefined && (typeof ev.app !== 'string' || ev.app.length > 64)) out.push(`event ${i}: bad app label`);
    if (ev.k === 'review') {
      if (!REVIEW_DECISIONS.has(String(ev.decision))) out.push(`event ${i}: review decision must be accept|keep`);
      if (!REVIEW_KINDS.has(String(ev.kind))) out.push(`event ${i}: unknown correction kind`);
    } else if (ev.decision !== undefined || ev.kind !== undefined) out.push(`event ${i}: decision/kind only allowed on review events`);
  });
  return out;
}
const KEYFILE = join(HOME, 'key.json');

const KC_SERVICE = 'merit-signing-key';
const KC_ACCOUNT = 'default';

/**
 * The operating system's own secret store, on every platform:
 * macOS Keychain, Windows Credential Manager, Linux Secret Service (GNOME Keyring / KWallet).
 * Encrypted at rest and unlocked with your login.
 */
function keychainRead(): string | null {
  try { return new Entry(KC_SERVICE, KC_ACCOUNT).getPassword() ?? null; } catch { return null; }
}
function keychainWrite(privateKey: string): boolean {
  try { new Entry(KC_SERVICE, KC_ACCOUNT).setPassword(privateKey); return true; } catch { return false; }
}

/** Self-custody: the key is created on this device and never leaves it. Keychain first, file as fallback. */
function loadOrCreateKey(): { privateKey: string; publicKey: string } {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const kc = keychainRead();
  if (kc) return { privateKey: kc, publicKey: publicKeyOf(kc) };
  if (existsSync(KEYFILE)) return JSON.parse(readFileSync(KEYFILE, 'utf8'));
  const k = generateKeyPair();
  if (keychainWrite(k.privateKey)) {
    console.error('merit: created your signing key in your system keychain (service "merit-signing-key"). It is your identity.');
  } else {
    writeFileSync(KEYFILE, JSON.stringify(k, null, 2));
    chmodSync(KEYFILE, 0o600);
    console.error(`merit: created your signing key at ${KEYFILE} (back it up; it is your identity)`);
  }
  return k;
}

/** Move an existing key file into the Keychain, verify it round-trips, then remove the file. */
function migrateKeyToKeychain(): string {
  if (!existsSync(KEYFILE)) return keychainRead() ? 'Key is already in the Keychain.' : 'No key file to migrate.';
  const k = JSON.parse(readFileSync(KEYFILE, 'utf8'));
  if (!keychainWrite(k.privateKey)) return 'Could not write to the Keychain; key file left in place.';
  const back = keychainRead();
  if (!back || back !== k.privateKey || publicKeyOf(back) !== k.publicKey) return 'Keychain copy did not verify; key file left in place.';
  unlinkSync(KEYFILE);
  return `Key moved into the Keychain and verified (public key ${k.publicKey.slice(0, 16)}…). The plain file was removed.`;
}

async function main() {
  const [cmd, file, ...rest] = process.argv.slice(2);
  const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === 'key' && file === 'migrate') {
    console.log(migrateKeyToKeychain());
    return;
  }
  if (cmd === 'whoami') {
    console.log(loadOrCreateKey().publicKey);
    return;
  }
  if (cmd === 'recognize') {
    if (!file) { console.log('usage: merit recognize <cert.json>'); process.exit(2); }
    const cert = JSON.parse(readFileSync(file, 'utf8'));
    if (cert.id !== attestationId(bodyOf(cert)) || !verifySignature(cert)) { console.log('refused: that certificate does not verify'); process.exit(1); }
    const key = loadOrCreateKey();
    if (publicKeyOf(key.privateKey) === cert.author.public_key) { console.log('refused: you cannot recognize your own certificate'); process.exit(1); }
    const out = file.replace(/\.cert\.json$|\.json$/, '') + '.recognition.json';
    writeFileSync(out, JSON.stringify(recognize(key.privateKey, cert.id), null, 2));
    console.log(`recognized ${cert.id} -> ${out}`);
    return;
  }
  if (cmd === 'calibrate') {
    const manifest = file && !file.startsWith('--') ? file : join(HOME, 'calibration', 'manifest.jsonl');
    if (!existsSync(manifest)) { console.log(`no manifest at ${manifest}; label sessions first with "merit label"`); process.exit(2); }
    const rows = readFileSync(manifest, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const samples: Sample[] = rows.map((row) => {
      const keys = readFileSync(resolve(dirname(manifest), row.session), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      const problems = privacyLint(keys);
      if (problems.length) throw new Error(`${row.session}: ${problems[0]}`);
      return { id: row.session, participant: row.participant, label: row.label, task: row.task, metrics: deriveKeyMetrics(keys) };
    });
    const all = [file, ...rest]; const ti = all.indexOf('--threshold');
    const th = ti >= 0 ? Number(all[ti + 1]) : 0.5;
    const report = calibrate(samples, Number.isFinite(th) ? th : 0.5);
    const out = join(dirname(manifest), 'report');
    writeFileSync(out + '.json', JSON.stringify(report, null, 2));
    writeFileSync(out + '.md', reportMarkdown(report));
    console.log(reportMarkdown(report) + `\nwrote ${out}.json and ${out}.md`);
    return;
  }
  if (cmd === 'label') {
    const label = rest[0] as CalLabel;
    const participant = flag('--participant');
    if (!file || !CAL_LABELS.includes(label) || !participant) {
      console.log('usage: merit label <session.jsonl> composed|retyped|ai-retyped --participant <id> [--task t] [--manifest m]'); process.exit(2);
    }
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(participant)) { console.log('participant must be a pseudonym (letters, digits, - _), never a name or email'); process.exit(2); }
    const manifest = flag('--manifest') ?? join(HOME, 'calibration', 'manifest.jsonl');
    mkdirSync(dirname(manifest), { recursive: true });
    const keys = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const problems = privacyLint(keys);
    if (problems.length) { console.log(`refused: ${problems[0]}`); process.exit(1); }
    const row = { session: resolve(file), label, participant, task: flag('--task'), labeled_at: new Date().toISOString() };
    appendFileSync(manifest, JSON.stringify(row) + '\n');
    console.log(`labeled ${file} as ${label} (${participant}) -> ${manifest}`);
    return;
  }
  if (!cmd || !file) {
    console.log('usage: merit verify <cert.json> [--ots f] [--text f] [--disclose f ...] [--offline] | stamp <cert.json> | upgrade <file.ots>');
    process.exit(2);
  }
  if (cmd === 'verify') {
    const cert = JSON.parse(readFileSync(file, 'utf8'));
    const otsPath = flag('--ots') ?? (existsSync(file + '.ots') ? file + '.ots' : undefined);
    const textPath = flag('--text');
    const disclosures = rest.flatMap((a, i) => (rest[i - 1] === '--disclose' ? [JSON.parse(readFileSync(a, 'utf8'))] : []));
    const r = await verifyCertificate({
      cert,
      ots: otsPath ? new Uint8Array(readFileSync(otsPath)) : undefined,
      text: textPath ? readFileSync(textPath, 'utf8') : undefined,
      disclosures: disclosures.length ? disclosures : undefined,
      network: !rest.includes('--offline'),
    });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  if (cmd === 'certify') {
    const keys: KeyEvent[] = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const problems = privacyLint(keys);
    if (problems.length) {
      console.error('merit: refusing to sign. This session contains more than key types:\n  ' + problems.slice(0, 5).join('\n  '));
      process.exit(3);
    }
    const k = loadOrCreateKey();
    const secret = newSessionSecret();
    const textPath = flag('--text');
    const cert = buildAttestation({
      events: keys,
      finalText: textPath ? readFileSync(textPath, 'utf8') : '',
      metrics: deriveKeyMetrics(keys),
      sessionSecret: secret,
      privateKey: k.privateKey,
      surface: 'merit-term/0.1',
    });
    const base = file.replace(/\.jsonl$/, '');
    writeFileSync(base + '.cert.json', JSON.stringify(cert, null, 2));
    writeFileSync(base + '.secret', secret); chmodSync(base + '.secret', 0o600);
    console.log(`certified ${cert.id} -> ${base}.cert.json`);
    if (rest.includes('--stamp')) {
      writeFileSync(base + '.cert.json.ots', await stamp(cert));
      console.log(`anchored (pending) -> ${base}.cert.json.ots`);
    }
    return;
  }
  if (cmd === 'stamp') {
    const ots = await stamp(JSON.parse(readFileSync(file, 'utf8')));
    writeFileSync(file + '.ots', ots);
    console.log(`wrote ${file}.ots (pending; run "merit upgrade" in a few hours)`);
    return;
  }
  if (cmd === 'upgrade') {
    const r = await upgrade(new Uint8Array(readFileSync(file)));
    if (r.changed) writeFileSync(file, r.ots);
    console.log(r.changed ? 'upgraded: Bitcoin attestation added' : 'not yet in a Bitcoin block; try again later');
    return;
  }
  console.log('unknown command'); process.exit(2);
}
if (process.argv[1] && /merit-cli|cli\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
