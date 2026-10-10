#!/usr/bin/env node
/**
 * merit CLI
 *   merit verify <cert.json> [--ots cert.ots] [--text doc.txt] [--disclose d1.json ...] [--offline]
 *   merit stamp <cert.json>          writes <cert.json>.ots (pending)
 *   merit upgrade <cert.json.ots>    upgrades in place once a Bitcoin block has it
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { verifyCertificate, stamp, upgrade } from './index';

async function main() {
  const [cmd, file, ...rest] = process.argv.slice(2);
  const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
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
