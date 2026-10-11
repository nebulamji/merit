import { attestationId, sha256Hex } from '@merit/spec';
import { verifySignature, bodyOf } from '@merit/attest';
import { shapeOf, type Shape } from './shape';

interface Mark { seq: number; id: string; key: string | null; created_utc: string; chain: string; shape: Shape }
interface Book { genesis: string; head: string; marks: Mark[] }

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Deterministic randomness from a hex id: the same certificate always draws the same mark. */
function prng(hex: string) {
  let a = (parseInt(hex.slice(0, 8), 16) ^ parseInt(hex.slice(8, 16), 16)) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

type Pt = [number, number];
interface Stroke { pts: Pt[]; kind: 'hand' | 'ruler' }
interface Drawn { strokes: Stroke[]; knots: Pt[]; at: Pt }

/**
 * A mark is the walk of a hand. Typing moves the pen forward; deletions walk it back over itself;
 * pauses lift it; pasted text is a ruled line with no hand in it; forgiven slips are tied off in gold.
 */
function drawMark(id: string, s: Shape, at: Pt, size: number): Drawn {
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

function css(name: string) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

class BookView {
  ctx: CanvasRenderingContext2D; w = 0; hgt = 0; drawn: { mark: Mark; d: Drawn }[] = []; t0 = performance.now(); rot = 0; spin = 0;
  constructor(public canvas: HTMLCanvasElement, public book: Book) { this.ctx = canvas.getContext('2d')!; this.layout(); addEventListener('resize', () => this.layout()); this.hover(); requestAnimationFrame(() => this.frame(performance.now())); }
  layout() {
    const dpr = devicePixelRatio || 1; const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width; this.hgt = rect.height; this.canvas.width = this.w * dpr; this.canvas.height = this.hgt * dpr; this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const head = this.book.head; this.spin = (parseInt(head.slice(0, 6), 16) / 0xffffff) * Math.PI * 2;
    const n = this.book.marks.length, R = Math.min(this.w, this.hgt) * 0.4;
    const ring = (i: number) => 0.16 + 0.84 * Math.sqrt(i / Math.max(8, n));
    const size = Math.max(9, Math.min(44, (R / Math.sqrt(Math.max(4, n))) * 1.6));
    this.drawn = this.book.marks.map((m, i) => { const a = (i + 1) * GOLDEN; const rr = R * ring(i + 1); return { mark: m, d: drawMark(m.id, m.shape, [Math.cos(a) * rr, Math.sin(a) * rr], size) }; });
  }
  add(m: Mark) { this.book.marks.push(m); this.book.head = m.chain; this.layout(); this.t0 = performance.now() - this.revealMs(this.book.marks.length - 1); }
  revealMs(i: number) { const per = Math.min(320, 6000 / Math.max(1, this.book.marks.length)); return 700 + i * per; }
  frame(t: number) {
    const c = this.ctx, ink = css('--ink'), gold = css('--gold'), faint = css('--faint');
    c.clearRect(0, 0, this.w, this.hgt);
    if (!reduced) this.rot = (t / 1000) * 0.006;
    c.save(); c.translate(this.w / 2, this.hgt / 2); c.rotate(this.spin + this.rot);
    // Mark 0: the paper.
    const g = this.book.genesis, R = Math.min(this.w, this.hgt) * 0.44;
    c.strokeStyle = faint; c.lineWidth = 1;
    for (let k = 0; k < 8; k++) { const a0 = (parseInt(g.slice(k * 4, k * 4 + 2), 16) / 255) * Math.PI * 2; const span = 0.4 + (parseInt(g.slice(k * 4 + 2, k * 4 + 4), 16) / 255) * 2.2; c.beginPath(); c.arc(0, 0, R * (0.03 + k * 0.012), a0, a0 + span); c.stroke(); }
    const elapsed = reduced ? Infinity : t - this.t0;
    this.drawn.forEach(({ d }, i) => {
      const p = Math.max(0, Math.min(1, (elapsed - this.revealMs(i)) / 600)); if (p <= 0) return;
      c.lineCap = 'round'; c.lineJoin = 'round';
      for (const s of d.strokes) {
        const upto = Math.max(1, Math.floor(s.pts.length * p));
        c.strokeStyle = ink; c.globalAlpha = s.kind === 'ruler' ? 0.45 : 0.85; c.lineWidth = s.kind === 'ruler' ? 0.8 : 1.15;
        c.setLineDash(s.kind === 'ruler' ? [2, 3] : []);
        c.beginPath(); s.pts.slice(0, upto + 1).forEach(([x, y], j) => (j ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
      }
      c.setLineDash([]); c.globalAlpha = 1;
      if (p >= 1) for (const [x, y] of d.knots) { c.fillStyle = gold; c.beginPath(); c.arc(x, y, 1.9, 0, Math.PI * 2); c.fill(); }
    });
    c.restore();
    requestAnimationFrame(() => this.frame(performance.now()));
  }
  hover() {
    const tip = $('#tip');
    this.canvas.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect(); const x = e.clientX - rect.left - this.w / 2, y = e.clientY - rect.top - this.hgt / 2;
      const a = -(this.spin + this.rot); const lx = x * Math.cos(a) - y * Math.sin(a), ly = x * Math.sin(a) + y * Math.cos(a);
      let best: { m: Mark; dist: number } | null = null;
      for (const { mark, d } of this.drawn) { const dist = Math.hypot(d.at[0] - lx, d.at[1] - ly); if (!best || dist < best.dist) best = { m: mark, dist }; }
      if (best && best.dist < 28) { tip.hidden = false; tip.style.left = `${e.clientX - rect.left + 12}px`; tip.style.top = `${e.clientY - rect.top + 12}px`; tip.textContent = `No. ${best.m.seq} · ${best.m.id.replace(/^merit_/, '').slice(0, 10)}`; this.canvas.style.cursor = 'pointer'; this.canvas.onclick = () => open(`/api/mark/${best!.m.seq}`, '_blank'); }
      else { tip.hidden = true; this.canvas.style.cursor = 'default'; this.canvas.onclick = null; }
    });
    this.canvas.addEventListener('pointerleave', () => (tip.hidden = true));
  }
}

/** The browser re-reads the whole book from Mark 0 and checks every link. */
function rereadChain(b: Book): boolean {
  let prev = b.genesis;
  for (const m of b.marks) { const c = sha256Hex(prev + m.id); if (c !== m.chain) return false; prev = c; }
  return prev === b.head;
}

function status(b: Book) {
  const ok = rereadChain(b);
  $('#status').textContent = `${b.marks.length} ${b.marks.length === 1 ? 'mark' : 'marks'} · ${ok ? 'chain re-read in your browser: intact' : 'chain BROKEN'} · head ${b.head.slice(0, 12)}`;
}

let pending: any = null;
function verifyLocal(text: string) {
  const out = $('#result'); const ins = $<HTMLButtonElement>('#inscribe'); const consent = $<HTMLInputElement>('#consent');
  pending = null; ins.disabled = true; consent.checked = false; $('#consent-row').hidden = true;
  if (!text.trim()) { out.textContent = ''; return; }
  let c: any; try { c = JSON.parse(text); } catch { out.dataset.state = 'bad'; out.textContent = 'That is not a certificate (not JSON).'; return; }
  const checks = { schema: c?.schema === 'merit-attestation/0.1', id: false, sig: false };
  try { checks.id = c.id === attestationId(bodyOf(c)); checks.sig = verifySignature(c); } catch { /* malformed */ }
  if (!(checks.schema && checks.id && checks.sig)) { out.dataset.state = 'bad'; out.textContent = `Does not verify: ${!checks.schema ? 'unknown format' : !checks.id ? 'the id does not match the content' : 'the signature does not match'}.`; return; }
  const s = shapeOf(c); const mins = Math.max(1, Math.round(s.active_s / 60));
  out.dataset.state = 'ok';
  out.textContent = `Verifies. Signed by ${c.author.public_key.slice(0, 12)}… · ${s.typed} characters typed, ${s.pasted} pasted · ${s.deletions} deletions · ${s.forgiveness} slips forgiven · ${mins} active ${mins === 1 ? 'minute' : 'minutes'}.`;
  pending = c; $('#consent-row').hidden = false;
}

async function main() {
  const book: Book = await fetch('/api/book').then((r) => r.json());
  const view = new BookView($('#book'), book); status(book);
  const ta = $<HTMLTextAreaElement>('#cert');
  ta.addEventListener('input', () => verifyLocal(ta.value));
  const file = $<HTMLInputElement>('#file');
  file.addEventListener('change', async () => { const f = file.files?.[0]; if (f) { ta.value = await f.text(); verifyLocal(ta.value); } });
  const drop = $('#drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.dataset.over = '1'; });
  drop.addEventListener('dragleave', () => delete drop.dataset.over);
  drop.addEventListener('drop', async (e) => { e.preventDefault(); delete drop.dataset.over; const f = e.dataTransfer?.files?.[0]; if (f) { ta.value = await f.text(); verifyLocal(ta.value); } });
  $<HTMLInputElement>('#consent').addEventListener('change', (e) => ($<HTMLButtonElement>('#inscribe').disabled = !(e.target as HTMLInputElement).checked || !pending));
  $<HTMLButtonElement>('#inscribe').addEventListener('click', async () => {
    if (!pending) return;
    const btn = $<HTMLButtonElement>('#inscribe'); btn.disabled = true;
    const r = await fetch('/api/inscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ certificate: pending, consent: true }) }).then((x) => x.json()).catch(() => ({ ok: false, reason: 'network error' }));
    const out = $('#result');
    if (!r.ok) { out.dataset.state = 'bad'; out.textContent = `Not inscribed: ${r.reason}.`; btn.disabled = false; return; }
    if (r.already) { out.textContent = `Already in the Book as No. ${r.seq}.`; return; }
    view.add({ seq: r.seq, id: pending.id, key: pending.author.public_key.slice(0, 12), created_utc: pending.created_utc, chain: r.chain, shape: shapeOf(pending) });
    status(view.book);
    out.textContent = `Inscribed as No. ${r.seq}. The Book now reads ${r.chain.slice(0, 12)}…`;
    document.getElementById('top')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    pending = null;
  });
}
main();
