// The Book's drawing, shared by the website canvas and the SVG images behind Portfolios and Marks.
// Deterministic: the same certificates always draw the same Book.
import type { Shape } from './shape';

export const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Deterministic randomness from a hex id: the same certificate always draws the same mark. */
export function prng(hex: string) {
  let a = (parseInt(hex.slice(0, 8), 16) ^ parseInt(hex.slice(8, 16), 16)) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export type Pt = [number, number];
export interface Stroke { pts: Pt[]; kind: 'hand' | 'ruler' }
/**
 * What happened along the walk, in order. `pt` is the index (into every stroke's points, taken in order) at which it happened,
 * so a replay can show the pen and the key-class stream in step. Typing is `char` (n characters in this step), deleting is `back`,
 * a lifted pen is `pause`, pasted text is `paste` (n characters), a slip recovered from is `knot`.
 * Reconstructed from the certificate's counts: the real keystroke log never leaves the author's device.
 */
export interface DrawEvent { k: 'char' | 'back' | 'pause' | 'paste' | 'knot'; pt: number; n?: number }
export interface Drawn { strokes: Stroke[]; knots: Pt[]; at: Pt; events: DrawEvent[]; n: number; signet: Pt[]; signetAt: Pt }

const hexBytes = (key: string): number[] => {
  const h = key.replace(/[^0-9a-f]/gi, '').toLowerCase().padEnd(16, '0'); const out: number[] = [];
  for (let i = 0; i + 1 < h.length && out.length < 12; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
  return out;
};
/**
 * The author's signet: a closed shape of unit radius drawn from their public key, the same every time for the same person and different
 * for different people. A mark is signed with it at the end of the walk. With no key it is a plain ring.
 */
export function signetShape(key: string | null | undefined): Pt[] {
  const N = 72, pts: Pt[] = [];
  if (!key) { for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; pts.push([Math.cos(a), Math.sin(a)]); } pts.push([...pts[0]] as Pt); return pts; }
  const b = hexBytes(key), lobes = 5 + (b[0] % 4), a1 = 0.12 + (b[1] / 255) * 0.17, a2 = 0.04 + (b[2] / 255) * 0.06, f1 = (b[3] / 255) * Math.PI * 2, f2 = (b[4] / 255) * Math.PI * 2;
  const r = (t: number) => 1 + a1 * Math.cos(lobes * t + f1) + a2 * Math.cos((lobes + 3) * t + f2);
  let max = 0; for (let i = 0; i < N; i++) max = Math.max(max, r((i / N) * Math.PI * 2));
  for (let i = 0; i < N; i++) { const t = (i / N) * Math.PI * 2, rr = r(t) / max; pts.push([Math.cos(t) * rr, Math.sin(t) * rr]); }
  pts.push([...pts[0]] as Pt);                       // closed exactly
  return pts;
}

/**
 * A mark is the walk of a hand. Typing moves the pen forward; deletions walk it back over itself;
 * pauses lift it; pasted text is a ruled line with no hand in it; forgiven slips are tied off in gold.
 * It ends with the author's signet.
 */
export function drawMark(id: string, s: Shape, at: Pt, size: number, key?: string | null): Drawn {
  const r = prng(id);
  const steps = Math.min(90, 6 + Math.round(Math.sqrt(s.typed) * 1.6));
  const backRate = Math.min(0.6, (s.deletions + s.word_changes * 2) / Math.max(1, s.typed));
  const lifts = Math.min(steps - 1, s.pauses);
  const liftAt = new Set<number>(); while (liftAt.size < lifts) liftAt.add(1 + Math.floor(r() * (steps - 1)));
  const step = size / Math.sqrt(steps + 4);
  const perStep = Math.max(1, Math.round(s.typed / steps));
  let h = r() * Math.PI * 2, p: Pt = [at[0], at[1]];
  const strokes: Stroke[] = []; let cur: Pt[] = [p]; const knots: Pt[] = [];
  const events: DrawEvent[] = []; let idx = 1, curStart = 0;
  let healed = 0;
  for (let i = 0; i < steps; i++) {
    if (liftAt.has(i)) { strokes.push({ pts: cur, kind: 'hand' }); h += (r() - 0.5) * 1.2; p = [p[0] + Math.cos(h) * step * 0.6, p[1] + Math.sin(h) * step * 0.6]; cur = [p]; curStart = idx; idx += 1; events.push({ k: 'pause', pt: idx }); }
    h += (r() - 0.5) * 0.9;
    p = [p[0] + Math.cos(h) * step, p[1] + Math.sin(h) * step]; cur.push(p); idx += 1; events.push({ k: 'char', pt: idx, n: perStep });
    if (r() < backRate && cur.length > 2) {
      const back = 1 + Math.floor(r() * Math.min(3, cur.length - 1));
      for (let k = 1; k <= back; k++) { const q = cur[cur.length - 1 - k * 2] ?? cur[0]; p = [q[0] + (r() - 0.5) * step * 0.25, q[1] + (r() - 0.5) * step * 0.25]; cur.push(p); idx += 1; events.push({ k: 'back', pt: idx }); }
      if (healed < s.forgiveness && r() < 0.7) { knots.push(p); healed++; events.push({ k: 'knot', pt: idx }); }
    }
  }
  strokes.push({ pts: cur, kind: 'hand' });
  const share = s.pasted / Math.max(1, s.typed + s.pasted);
  if (share > 0.02) { const L = size * 1.4 * share; strokes.push({ pts: [p, [p[0] + Math.cos(h) * L, p[1] + Math.sin(h) * L]], kind: 'ruler' }); idx += 2; events.push({ k: 'paste', pt: idx, n: s.pasted }); }
  while (healed < Math.min(s.forgiveness, 6)) { const pick = Math.floor(r() * cur.length); knots.push(cur[pick]); healed++; events.push({ k: 'knot', pt: curStart + pick + 1 }); }
  // A hand wanders; keep each mark within reach of its place in the Book.
  const all = [...strokes.flatMap((x) => x.pts), ...knots];
  const reach = Math.max(...all.map(([x, y]) => Math.hypot(x - at[0], y - at[1])));
  const k = reach > size * 1.25 ? (size * 1.25) / reach : 1;
  const fit = ([x, y]: Pt): Pt => [at[0] + (x - at[0]) * k, at[1] + (y - at[1]) * k];
  const end = fit(strokes[strokes.length - 1].pts[strokes[strokes.length - 1].pts.length - 1]);
  // The signature: this person's signet, turned by this certificate's own seed, set where the walk ends.
  const turn = prng(id.split('').reverse().join(''))() * Math.PI * 2, sr = Math.max(2.5, size * 0.17);
  const signet = signetShape(key).map(([x, y]): Pt => [end[0] + (x * Math.cos(turn) - y * Math.sin(turn)) * sr, end[1] + (x * Math.sin(turn) + y * Math.cos(turn)) * sr]);
  events.sort((a, b) => a.pt - b.pt);
  return { strokes: strokes.map((x) => ({ ...x, pts: x.pts.map(fit) })), knots: knots.map(fit), at, events, n: idx, signet, signetAt: end };
}


export interface MarkLike { id: string; shape: Shape; seq?: number; by_seq?: number | null; key?: string | null }

/** Everything the drawing puts down, as points (strokes, knots, signets). */
const everyPoint = (d: Drawn): Pt[] => [...d.strokes.flatMap((x) => x.pts), ...d.knots, ...d.signet];
/** Scale the whole drawing about the centre so nothing reaches past `limit`: no mark or signature is ever cut off, whatever the rotation. */
function keepWithin(drawn: Drawn[], limit: number): Drawn[] {
  const reach = Math.max(1, ...drawn.flatMap((d) => everyPoint(d).map(([x, y]) => Math.hypot(x, y))));
  if (reach <= limit) return drawn;
  const k = limit / reach, sc = ([x, y]: Pt): Pt => [x * k, y * k];
  return drawn.map((d) => ({ ...d, strokes: d.strokes.map((x) => ({ ...x, pts: x.pts.map(sc) })), knots: d.knots.map(sc), at: sc(d.at), signet: d.signet.map(sc), signetAt: sc(d.signetAt) }));
}

/** Place every mark on the golden-angle spiral; the whole turns by the chain head. A young Book is drawn tighter and larger so it reads at a glance. */
export function layoutBook(marks: MarkLike[], head: string, w: number, h: number): { drawn: Drawn[]; spin: number; R: number } {
  const spin = (parseInt(head.slice(0, 6), 16) / 0xffffff) * Math.PI * 2;
  const n = marks.length, young = Math.min(1, 0.5 + n / 16), R = Math.min(w, h) * 0.4 * young;
  const ring = (i: number) => 0.16 + 0.84 * Math.sqrt(i / Math.max(8, n));
  const cap = n < 12 ? 150 : 90, size = Math.max(9, Math.min(cap, (R / Math.sqrt(Math.max(4, n))) * 1.6));
  const drawn = marks.map((m, i) => { const a = (i + 1) * GOLDEN; const rr = R * ring(i + 1); return drawMark(m.id, m.shape, [Math.cos(a) * rr, Math.sin(a) * rr], size, m.key); });
  return { drawn: keepWithin(drawn, Math.min(w, h) * 0.46), spin, R };
}

const f = (x: number) => (Math.round(x * 10) / 10).toString();
const pathOf = (pts: Pt[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('');

/** A still image of the Book (or one mark) as SVG: paper, ink, gold. */
export function bookSVG(marks: MarkLike[], head: string, genesis: string, opts: { size?: number; title?: string } = {}): string {
  const W = opts.size ?? 1200, H = W;
  const { drawn, spin, R } = layoutBook(marks, head, W, H);
  const bySeq = new Map(marks.map((m, i) => [m.seq, drawn[i].at] as const));
  const out: string[] = [];
  for (let k = 0; k < 8; k++) {
    const a0 = (parseInt(genesis.slice(k * 4, k * 4 + 2), 16) / 255) * Math.PI * 2;
    const span = 0.4 + (parseInt(genesis.slice(k * 4 + 2, k * 4 + 4), 16) / 255) * 2.2;
    const r = R * 1.1 * (0.03 + k * 0.012);
    const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r, x1 = Math.cos(a0 + span) * r, y1 = Math.sin(a0 + span) * r;
    out.push(`<path d="M${f(x0)} ${f(y0)}A${f(r)} ${f(r)} 0 ${span > Math.PI ? 1 : 0} 1 ${f(x1)} ${f(y1)}" stroke="#b9b2a3" stroke-width="1.2" fill="none"/>`);
  }
  marks.forEach((m, i) => {
    if (m.by_seq === -1) return;
    const from = (m.by_seq && bySeq.get(m.by_seq)) || [0, 0];
    out.push(`<path d="M${f(from[0])} ${f(from[1])}L${f(drawn[i].at[0])} ${f(drawn[i].at[1])}" stroke="#b9b2a3" stroke-width="0.7" opacity="0.6"/>`);
  });
  for (const d of drawn) {
    for (const s of d.strokes) out.push(`<path d="${pathOf(s.pts)}" stroke="#1b1a17" stroke-width="${s.kind === 'ruler' ? 1 : 1.4}" fill="none" stroke-linecap="round" stroke-linejoin="round"${s.kind === 'ruler' ? ' stroke-dasharray="2 3" opacity="0.5"' : ' opacity="0.88"'}/>`);
    for (const [x, y] of d.knots) out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="2.4" fill="#b0841f"/>`);
    out.push(`<path d="${pathOf(d.signet)}Z" stroke="#b0841f" stroke-width="1.1" fill="none"/>`);
  }
  const title = opts.title ? `<title>${opts.title.replace(/[<&]/g, '')}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${title}<rect width="100%" height="100%" fill="#f6f3ec"/><g transform="translate(${W / 2} ${H / 2}) rotate(${f((spin * 180) / Math.PI)})">${out.join('')}</g></svg>`;
}
