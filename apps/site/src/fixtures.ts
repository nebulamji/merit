// Local-only: synthetic certificates signed by throwaway keys, for exercising the Book. Never deployed.
import { generateKeyPair, newSessionSecret, buildAttestation } from '@merit/attest';
import { deriveKeyMetrics } from '@merit/capture';
import type { KeyEvent } from '@merit/spec';
let s = 7; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const out: unknown[] = [];
for (let i = 0; i < Number(process.argv[2] ?? 40); i++) {
  const keys: KeyEvent[] = []; let t = 0; const del = r() * 0.15, pause = r() * 0.05, words = 40 + Math.floor(r() * 400);
  for (let w = 0; w < words; w++) {
    for (let c = 0; c < 3 + r() * 6; c++) { t += 80 + r() * 200; keys.push({ seq: keys.length, t: Math.round(t), k: 'char' } as KeyEvent); }
    if (r() < del) for (let d = 0; d < 1 + r() * 4; d++) { t += 120; keys.push({ seq: keys.length, t: Math.round(t), k: 'back' } as KeyEvent); }
    if (r() < pause) t += 2500 + r() * 6000;
    t += 100; keys.push({ seq: keys.length, t: Math.round(t), k: 'space' } as KeyEvent);
  }
  if (r() < 0.2) { t += 300; keys.push({ seq: keys.length, t: Math.round(t), k: 'paste', n: Math.floor(50 + r() * 900) } as KeyEvent); }
  const kp = generateKeyPair();
  out.push(buildAttestation({ events: keys as any, finalText: '', metrics: deriveKeyMetrics(keys), sessionSecret: newSessionSecret(), privateKey: kp.privateKey, surface: 'fixture' }));
}
console.log(JSON.stringify(out));
