// Local-only: a recognition chain signed by throwaway keys, for testing the Book end to end.
// T0 plays the founder (wrangler dev --var FOUNDER:<T0>). Never deployed.
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateKeyPair, newSessionSecret, buildAttestation, recognize } from '@merit/attest';
import { deriveKeyMetrics } from '@merit/capture';
import type { KeyEvent } from '@merit/spec';
const dir = process.argv[2]; mkdirSync(dir, { recursive: true });
const keys = Array.from({ length: 4 }, () => generateKeyPair());
let s = 11; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
function cert(i: number) {
  const ev: KeyEvent[] = []; let t = 0;
  for (let w = 0; w < 80 + i * 20; w++) {
    for (let c = 0; c < 3 + r() * 6; c++) { t += 80 + r() * 200; ev.push({ seq: ev.length, t: Math.round(t), k: 'char' } as KeyEvent); }
    if (r() < 0.12) for (let d = 0; d < 1 + r() * 3; d++) { t += 120; ev.push({ seq: ev.length, t: Math.round(t), k: 'back' } as KeyEvent); }
    if (r() < 0.04) t += 3000 + r() * 5000;
    t += 100; ev.push({ seq: ev.length, t: Math.round(t), k: 'space' } as KeyEvent);
  }
  return buildAttestation({ events: ev as any, finalText: '', metrics: deriveKeyMetrics(ev), sessionSecret: newSessionSecret(), privateKey: keys[i].privateKey, surface: 'fixture' });
}
const certs = [0, 1, 2, 3].map(cert);
certs.forEach((c, i) => writeFileSync(`${dir}/${'ABCD'[i]}.cert.json`, JSON.stringify(c)));
writeFileSync(`${dir}/B.recognition.json`, JSON.stringify(recognize(keys[0].privateKey, certs[1].id)));  // founder recognizes B
writeFileSync(`${dir}/C.recognition.json`, JSON.stringify(recognize(keys[1].privateKey, certs[2].id)));  // B recognizes C
writeFileSync(`${dir}/D.recognition.json`, JSON.stringify(recognize(generateKeyPair().privateKey, certs[3].id))); // outsider recognizes D
writeFileSync(`${dir}/founder.txt`, keys[0].publicKey);
console.log('wrote chain to', dir);
