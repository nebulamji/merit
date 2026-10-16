import { test, expect } from 'vitest';
import { drawMark, signetShape, layoutBook, bookSVG } from '../src/art';
import type { Shape } from '../src/shape';

const shape = (o: Partial<Shape> = {}): Shape => ({ typed: 900, pasted: 0, deletions: 45, typo_fixes: 6, word_changes: 4, bursts: 5, pauses: 4, forgiveness: 3, active_s: 700, ...o });
const ID = 'merit_0123456789abcdef0123', ID2 = 'merit_fedcba9876543210fedc', KEY = '3fa9c1d2e4b5', KEY2 = '7be012aa90cd';
const shapeSig = (pts: [number, number][]) => pts.map(([x, y]) => Math.hypot(x, y).toFixed(4)).join(',');   // radii only: unchanged by rotation

test('the same certificate always draws the same mark; a different certificate draws a different one', () => {
  expect(JSON.stringify(drawMark(ID, shape(), [0, 0], 60, KEY))).toBe(JSON.stringify(drawMark(ID, shape(), [0, 0], 60, KEY)));
  expect(JSON.stringify(drawMark(ID, shape(), [0, 0], 60, KEY))).not.toBe(JSON.stringify(drawMark(ID2, shape(), [0, 0], 60, KEY)));
});

test('the replay events follow the certificate: pauses, knots and paste match the counts, order is causal, every event lands on a real point', () => {
  const s = shape({ typed: 1200, pauses: 5, forgiveness: 4, pasted: 300 }), d = drawMark(ID, s, [0, 0], 80, KEY);
  const total = d.strokes.reduce((t, x) => t + x.pts.length, 0);
  expect(d.n).toBe(total);
  expect(d.events.filter((e) => e.k === 'pause').length).toBe(5);
  expect(d.events.filter((e) => e.k === 'knot').length).toBe(d.knots.length);
  expect(d.events.filter((e) => e.k === 'paste').length).toBe(1);
  expect(d.events.find((e) => e.k === 'paste')!.n).toBe(300);
  for (let i = 1; i < d.events.length; i++) expect(d.events[i].pt).toBeGreaterThanOrEqual(d.events[i - 1].pt);
  for (const e of d.events) { expect(e.pt).toBeGreaterThanOrEqual(1); expect(e.pt).toBeLessThanOrEqual(d.n); }
  const typedShown = d.events.filter((e) => e.k === 'char').reduce((t, e) => t + (e.n ?? 0), 0);
  expect(Math.abs(typedShown - 1200) / 1200).toBeLessThan(0.15);                       // the stream shows about as many characters as were typed
  expect(d.events.filter((e) => e.k === 'back').length).toBeGreaterThan(0);
});

test('no paste event and no ruler when nothing was pasted; no back events when nothing was deleted', () => {
  const d = drawMark(ID, shape({ pasted: 0, deletions: 0, word_changes: 0 }), [0, 0], 60, KEY);
  expect(d.events.some((e) => e.k === 'paste')).toBe(false); expect(d.strokes.some((x) => x.kind === 'ruler')).toBe(false); expect(d.events.some((e) => e.k === 'back')).toBe(false);
});

test('the signet is the author: same key, same shape (turned per certificate); different keys, different shapes; no key is a ring; always closed and bounded', () => {
  expect(shapeSig(signetShape(KEY))).toBe(shapeSig(signetShape(KEY)));
  expect(shapeSig(signetShape(KEY))).not.toBe(shapeSig(signetShape(KEY2)));
  const ring = signetShape(null); expect(ring.every(([x, y]) => Math.abs(Math.hypot(x, y) - 1) < 1e-9)).toBe(true);
  for (const k of [KEY, KEY2, null, '00', 'ffffffffffff']) { const p = signetShape(k); expect(p[0]).toEqual(p[p.length - 1]); expect(Math.max(...p.map(([x, y]) => Math.hypot(x, y)))).toBeLessThanOrEqual(1 + 1e-9); expect(Math.min(...p.map(([x, y]) => Math.hypot(x, y)))).toBeGreaterThan(0.4); }
  // inside a drawn mark: same author on two different acts gives the same signet shape, turned differently; two authors differ
  const a = drawMark(ID, shape(), [0, 0], 60, KEY), b = drawMark(ID2, shape(), [10, 10], 60, KEY), c = drawMark(ID, shape(), [0, 0], 60, KEY2);
  const rad = (d: ReturnType<typeof drawMark>) => d.signet.map(([x, y]) => Math.hypot(x - d.signetAt[0], y - d.signetAt[1]).toFixed(3)).join(',');
  expect(rad(a)).toBe(rad(b)); expect(rad(a)).not.toBe(rad(c));
});

test('the signet sits where the walk ends, and is part of the still image too', () => {
  const d = drawMark(ID, shape(), [5, 5], 60, KEY); const last = d.strokes[d.strokes.length - 1].pts; expect(d.signetAt).toEqual(last[last.length - 1]);
  const svg = bookSVG([{ id: ID, shape: shape(), seq: 1, by_seq: -1, key: KEY }], 'ab'.repeat(32), 'cd'.repeat(32));
  expect(svg).toContain('stroke="#b0841f"'); expect(svg).toContain('Z"');
  expect(layoutBook([{ id: ID, shape: shape(), key: KEY }], 'ab'.repeat(32), 800, 800).drawn[0].signet.length).toBeGreaterThan(10);
});

test('nothing is ever cut off: every point of every mark, signature included, stays inside the circle that survives any rotation', () => {
  for (const n of [1, 2, 4, 9, 14, 60, 300]) for (const [w, h] of [[800, 800], [530, 366], [1200, 1200]] as const) {
    const marks = Array.from({ length: n }, (_, i) => ({ id: 'merit_' + (i * 2654435761 >>> 0).toString(16).padStart(8, '0') + 'abcdef012345', shape: shape({ typed: 100 + ((i * 977) % 2500), pasted: i % 3 ? 0 : 400, deletions: (i * 37) % 200, pauses: i % 9, forgiveness: i % 6 }), seq: i + 1, key: ['3fa9c1d2e4b5', '7be012aa90cd'][i % 2] }));
    const { drawn } = layoutBook(marks, 'ab'.repeat(32), w, h), limit = Math.min(w, h) * 0.46 + 1e-6;
    for (const d of drawn) for (const [x, y] of [...d.strokes.flatMap((s) => s.pts), ...d.knots, ...d.signet]) expect(Math.hypot(x, y)).toBeLessThanOrEqual(limit);
    expect(drawn.length).toBe(n);
  }
});
