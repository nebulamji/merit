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
export interface Drawn { strokes: Stroke[]; knots: Pt[]; at: Pt }

/**
 * A mark is the walk of a hand. Typing moves the pen forward; deletions walk it back over itself;
 * pauses lift it; pasted text is a ruled line with no hand in it; forgiven slips are tied off in gold.
 */
export function drawMark(id: string, s: Shape, at: Pt, size: number): Drawn {
  const r = prng(id);
  const steps = Math.min(90, 6 + Math.round(Math.sqrt(s.typed) * 1.6));
  const backRate = Math.min(0.6, (s.deletions + s.word_changes * 2) / Math.max(1, s.typed));
  const lifts = Math.min(steps - 1, s.pauses);
  const liftAt = new Set<number>(); while (liftAt.size < lifts) liftAt.add(1 + Math.floor(r() * (steps - 1)));
  const step = size / Math.sqrt(steps + 4);
  let h = r() * Math.PI * 2, p: Pt = [at[0], at[1]];
  const strokes: Stroke[] = []; let cur: Pt[] = [p]; const knots: Pt[] = [];
  let healed = 0;
  for (let i = 0; i < steps; i++) {
    if (liftAt.has(i)) { strokes.push({ pts: cur, kind: 'hand' }); h += (r() - 0.5) * 1.2; p = [p[0] + Math.cos(h) * step * 0.6, p[1] + Math.sin(h) * step * 0.6]; cur = [p]; }
    h += (r() - 0.5) * 0.9;
    p = [p[0] + Math.cos(h) * step, p[1] + Math.sin(h) * step]; cur.push(p);
    if (r() < backRate && cur.length > 2) {
      const back = 1 + Math.floor(r() * Math.min(3, cur.length - 1));
      for (let k = 1; k <= back; k++) { const q = cur[cur.length - 1 - k * 2] ?? cur[0]; p = [q[0] + (r() - 0.5) * step * 0.25, q[1] + (r() - 0.5) * step * 0.25]; cur.push(p); }
      if (healed < s.forgiveness && r() < 0.7) { knots.push(p); healed++; }
    }
  }
  strokes.push({ pts: cur, kind: 'hand' });
  const share = s.pasted / Math.max(1, s.typed + s.pasted);
  if (share > 0.02) { const L = size * 1.4 * share; strokes.push({ pts: [p, [p[0] + Math.cos(h) * L, p[1] + Math.sin(h) * L]], kind: 'ruler' }); }
  while (healed < Math.min(s.forgiveness, 6)) { knots.push(cur[Math.floor(r() * cur.length)]); healed++; }
  // A hand wanders; keep each mark within reach of its place in the Book.
  const all = [...strokes.flatMap((x) => x.pts), ...knots];
  const reach = Math.max(...all.map(([x, y]) => Math.hypot(x - at[0], y - at[1])));
  const k = reach > size * 1.25 ? (size * 1.25) / reach : 1;
  const fit = ([x, y]: Pt): Pt => [at[0] + (x - at[0]) * k, at[1] + (y - at[1]) * k];
  return { strokes: strokes.map((x) => ({ ...x, pts: x.pts.map(fit) })), knots: knots.map(fit), at };
}


export interface MarkLike { id: string; shape: Shape; seq?: number; by_seq?: number | null }

/** Place every mark on the golden-angle spiral; the whole turns by the chain head. */
export function layoutBook(marks: MarkLike[], head: string, w: number, h: number): { drawn: Drawn[]; spin: number; R: number } {
  const spin = (parseInt(head.slice(0, 6), 16) / 0xffffff) * Math.PI * 2;
  const n = marks.length, R = Math.min(w, h) * 0.4;
  const ring = (i: number) => 0.16 + 0.84 * Math.sqrt(i / Math.max(8, n));
  const size = Math.max(9, Math.min(90, (R / Math.sqrt(Math.max(4, n))) * 1.6));
  const drawn = marks.map((m, i) => { const a = (i + 1) * GOLDEN; const rr = R * ring(i + 1); return drawMark(m.id, m.shape, [Math.cos(a) * rr, Math.sin(a) * rr], size); });
  return { drawn, spin, R };
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
  }
  const title = opts.title ? `<title>${opts.title.replace(/[<&]/g, '')}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${title}<rect width="100%" height="100%" fill="#f6f3ec"/><g transform="translate(${W / 2} ${H / 2}) rotate(${f((spin * 180) / Math.PI)})">${out.join('')}</g></svg>`;
}
