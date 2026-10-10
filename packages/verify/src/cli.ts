#!/usr/bin/env node
/**
 * merit CLI
 *   merit verify <cert.json> [--ots cert.ots] [--text doc.txt] [--disclose d1.json ...] [--offline]
 *   merit stamp <cert.json>          writes <cert.json>.ots (pending)
 *   merit upgrade <cert.json.ots>    upgrades in place once a Bitcoin block has it
 *   merit certify <session.jsonl> [--text doc.txt] [--stamp]   sign a recorded session
 *   merit whoami                     print your public key (creates your key on first run)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { verifyCertificate, stamp, upgrade } from './index';
import { generateKeyPair, newSessionSecret, buildAttestation } from '@merit/attest';
import { deriveKeyMetrics } from '@merit/capture';
import type { KeyEvent } from '@merit/spec';

const HOME = join(homedir(), '.merit');
const KEYFILE = join(HOME, 'key.json');

/** Self-custody: the key is created on this device and never leaves it. */
function loadOrCreateKey(): { privateKey: string; publicKey: string } {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  if (existsSync(KEYFILE)) return JSON.parse(readFileSync(KEYFILE, 'utf8'));
  const k = generateKeyPair();
  writeFileSync(KEYFILE, JSON.stringify(k, null, 2));
  chmodSync(KEYFILE, 0o600);
  console.error(`merit: created your signing key at ${KEYFILE} (back it up; it is your identity)`);
  return k;
}

async function main() {
  const [cmd, file, ...rest] = process.argv.slice(2);
  const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === 'whoami') {
    console.log(loadOrCreateKey().publicKey);
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
main().catch((e) => { console.error(e); process.exit(1); });
