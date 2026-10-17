// Shared test vectors for the commitment root. The TypeScript produces them; the Rust (cargo test) must reproduce every one.
// If either side changes how the root is computed, a test fails. Regenerate deliberately with UPDATE_VECTORS=1.
import { test, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { merkleRoot } from '@merit/attest';

const FILE = new URL('./vectors/events-root.json', import.meta.url);
function build() {
  let s = 424242; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const C = ['char', 'char', 'space', 'upper', 'digit', 'punct', 'back', 'del', 'enter', 'nav', 'select', 'undo', 'paste', 'cmd'];
  return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 31, 33, 64, 100, 257, 1000].map((n, vi) => {
    const secret = Array.from({ length: 32 }, (_, i) => ((vi * 31 + i * 7) & 255).toString(16).padStart(2, '0')).join('');
    let t = 0; const keys = Array.from({ length: n }, (_, i) => { t += 20 + Math.floor(rnd() * 400); const k = C[Math.floor(rnd() * C.length)]; return k === 'paste' && rnd() < 0.5 ? { seq: i, t, k, n: 1 + Math.floor(rnd() * 900) } : { seq: i, t, k }; });
    return { secret, keys, root: merkleRoot(keys as any, secret) };
  });
}

test('commitment vectors match the committed file (the Rust side is tested against the same file)', () => {
  const v = build();
  if (process.env.UPDATE_VECTORS) writeFileSync(FILE, JSON.stringify(v));
  expect(JSON.parse(readFileSync(FILE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(v)));
  expect(v.length).toBeGreaterThanOrEqual(15);
});
