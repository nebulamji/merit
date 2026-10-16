#!/usr/bin/env node
// Re-checks every OpenTimestamps anchor in anchors/ against public Bitcoin block data. Anyone can run this; it trusts nothing in this repository.
// Usage: pnpm install && node scripts/verify-anchors.mjs [dir]
import { createRequire } from 'node:module'; import { readFileSync, readdirSync } from 'node:fs'; import { createHash } from 'node:crypto'; import { join } from 'node:path';
const require = createRequire(new URL('../packages/verify/package.json', import.meta.url)); const OT = require('opentimestamps');
const dir = process.argv[2] || new URL('../anchors', import.meta.url).pathname;
const quiet = async (fn) => { const l = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = l; } };
let bad = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.ots')).sort()) {
  const file = join(dir, f.slice(0, -4)); let line;
  try {
    const bytes = readFileSync(file), sha = createHash('sha256').update(bytes).digest('hex');
    const det = OT.DetachedTimestampFile.fromBytes(new OT.Ops.OpSHA256(), Uint8Array.from(bytes)), dots = OT.DetachedTimestampFile.deserialize(Uint8Array.from(readFileSync(join(dir, f))));
    if (Buffer.from(dots.fileDigest()).toString('hex') !== sha) throw new Error('the file is not the one that was stamped');
    const r = await quiet(() => OT.verify(dots, det, { ignoreBitcoinNode: true, timeout: 20000 }));
    line = r?.bitcoin ? `OK       ${f.slice(0, -4).padEnd(30)} Bitcoin block ${r.bitcoin.height}  ${new Date(r.bitcoin.timestamp * 1000).toISOString()}` : `PENDING  ${f.slice(0, -4).padEnd(30)} submitted, not yet in a block`;
  } catch (e) { bad++; line = `FAILED   ${f.slice(0, -4).padEnd(30)} ${String(e.message).slice(0, 80)}`; }
  console.log(line);
}
console.log(bad ? `\n${bad} anchor(s) failed.` : '\nEvery anchor checks out: each file existed no later than its block time.');
process.exit(bad ? 1 : 0);
