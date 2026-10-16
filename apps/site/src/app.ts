import { attestationId, sha256Hex } from '@merit/spec';
import { verifySignature, bodyOf } from '@merit/attest';
import { shapeOf, type Shape } from './shape';
import { layoutBook, signetShape, type Drawn, type DrawEvent, type Pt } from './art';
import { FOUNDER, EARN, workFloor, anchorClaim, recognitionClaim, anchorDigestHex } from './qualify';
import { readOts } from '../../../packages/verify/src/ots';
import { blockMerkleRoot } from '../../../packages/verify/src/ots';

interface Mark { seq: number; id: string; key: string | null; created_utc: string; chain: string; shape: Shape; by_seq?: number | null; anchor_height?: number | null; sample?: boolean }
interface Book { genesis: string; head: string; marks: Mark[]; founder?: string }

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
function css(name: string) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

// Sample sessions: shown until the first real marks arrive, so the page is never an empty etching. Labelled as samples everywhere.
const SAMPLES: Mark[] = [
  { id: 'merit_5a1f93c07be21d4408aa', key: '3fa9c1d2e4b5', shape: { typed: 1400, pasted: 0, deletions: 60, typo_fixes: 9, word_changes: 5, bursts: 6, pauses: 5, forgiveness: 4, active_s: 1500 } },
  { id: 'merit_c20b7e51a9d34f6e1188', key: '7be012aa90cd', shape: { typed: 900, pasted: 0, deletions: 210, typo_fixes: 30, word_changes: 22, bursts: 9, pauses: 2, forgiveness: 6, active_s: 1100 } },
  { id: 'merit_91d8f2a6034be7cc5d02', key: 'c4d18e6f2a09', shape: { typed: 600, pasted: 900, deletions: 12, typo_fixes: 2, word_changes: 1, bursts: 3, pauses: 1, forgiveness: 0, active_s: 420 } },
  { id: 'merit_e7a3406bd15c98f2a371', key: '3fa9c1d2e4b5', shape: { typed: 2100, pasted: 0, deletions: 90, typo_fixes: 14, word_changes: 8, bursts: 11, pauses: 9, forgiveness: 5, active_s: 2300 } },
].map((m, i) => ({ ...m, seq: i + 1, created_utc: '', chain: '', by_seq: -1, sample: true }));
const SAMPLE_HEAD = 'a5c3e1b97d2f4608a5c3e1b97d2f4608a5c3e1b97d2f4608a5c3e1b97d2f4608';

const fmt = (n: number) => n.toLocaleString('en-US');
const mins = (s: number) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`);

class BookView {
  ctx: CanvasRenderingContext2D; w = 0; hgt = 0; dpr = 1; drawn: { mark: Mark; d: Drawn }[] = []; spin = 0;
  base: HTMLCanvasElement = document.createElement('canvas'); bctx = this.base.getContext('2d')!;
  keysCv = $<HTMLCanvasElement>('#keys'); kctx = this.keysCv.getContext('2d')!; now = $('#now'); replayBtn = $<HTMLButtonElement>('#replay'); sampleNote = $('#sample-note');
  bySeq = new Map<number, Pt>(); glyphs: DrawEvent['k'][] = []; evDone = 0;
  phase: 'idle' | 'walk' | 'sign' | 'done' = 'idle'; i = 0; t0 = 0; durs: number[] = []; from = 0; raf = 0;
  spinAnim: Animation | null = null; ink = ''; gold = ''; faint = ''; bad = '';
  constructor(public canvas: HTMLCanvasElement, public book: Book) {
    this.ctx = canvas.getContext('2d')!; this.colors(); this.layout(); this.hover();
    let rt = 0; addEventListener('resize', () => { clearTimeout(rt); rt = window.setTimeout(() => { this.layout(); this.finish(); }, 150); });
    this.replayBtn.addEventListener('click', () => this.replay());
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { this.colors(); this.layout(); this.finish(); });
    if (!reduced) this.spinAnim = canvas.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], { duration: 1047000, iterations: Infinity });   // 0.006 rad/s, on the compositor: no redraw
    this.replay();
  }
  colors() { this.ink = css('--ink'); this.gold = css('--gold'); this.faint = css('--faint'); this.bad = css('--bad') || '#b5503c'; }
  get shown(): Mark[] { return this.book.marks.length ? this.book.marks : SAMPLES; }
  layout() {
    const dpr = (this.dpr = Math.min(2, devicePixelRatio || 1)), rect = this.canvas.getBoundingClientRect();
    this.w = this.canvas.offsetWidth || rect.width; this.hgt = this.canvas.offsetHeight || rect.height;
    for (const c of [this.canvas, this.base]) { c.width = Math.round(this.w * dpr); c.height = Math.round(this.hgt * dpr); }
    this.keysCv.width = Math.round(this.keysCv.offsetWidth * dpr); this.keysCv.height = Math.round(this.keysCv.offsetHeight * dpr);
    const marks = this.shown, head = this.book.marks.length ? this.book.head : SAMPLE_HEAD;
    const L = layoutBook(marks, head, this.w, this.hgt); this.spin = L.spin;
    this.drawn = marks.map((m, i) => ({ mark: m, d: L.drawn[i] }));
    this.bySeq = new Map(this.drawn.map((x) => [x.mark.seq, x.d.at] as const));
    this.sampleNote.hidden = !this.book.marks.length ? false : true;
  }
  add(m: Mark) { this.book.marks.push(m); this.book.head = m.chain; this.layout(); this.paintBase(this.drawn.length - 1); this.from = this.drawn.length - 1; this.run(); }
  // ---- painting
  place(c: CanvasRenderingContext2D) { c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.translate(this.w / 2, this.hgt / 2); c.rotate(this.spin); }
  mark0(c: CanvasRenderingContext2D) {
    const g = this.book.genesis, R = Math.min(this.w, this.hgt) * 0.44; c.strokeStyle = this.faint; c.lineWidth = 1;
    for (let k = 0; k < 8; k++) { const a0 = (parseInt(g.slice(k * 4, k * 4 + 2), 16) / 255) * Math.PI * 2; const span = 0.4 + (parseInt(g.slice(k * 4 + 2, k * 4 + 4), 16) / 255) * 2.2; c.beginPath(); c.arc(0, 0, R * (0.03 + k * 0.012) * 1.1, a0, a0 + span); c.stroke(); }
  }
  thread(c: CanvasRenderingContext2D, x: { mark: Mark; d: Drawn }) {
    if (x.mark.by_seq === -1) return; const from = (x.mark.by_seq && this.bySeq.get(x.mark.by_seq)) || [0, 0];
    c.strokeStyle = this.faint; c.lineWidth = 0.6; c.globalAlpha = 0.55; c.beginPath(); c.moveTo(from[0], from[1]); c.lineTo(x.d.at[0], x.d.at[1]); c.stroke(); c.globalAlpha = 1;
  }
  strokes(c: CanvasRenderingContext2D, d: Drawn, upto: number): Pt {
    // draw the walk up to `upto` points (fractional): the pen is wherever it has got to
    let left = upto, pen: Pt = d.at; c.lineCap = 'round'; c.lineJoin = 'round';
    for (const s of d.strokes) {
      if (left <= 0) break;
      const whole = Math.min(s.pts.length, Math.floor(left)), frac = left - whole, pts = s.pts.slice(0, whole) as Pt[];
      if (frac > 0 && whole < s.pts.length && whole > 0) { const a = s.pts[whole - 1], b = s.pts[whole]; pts.push([a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]); }
      left -= s.pts.length;
      if (pts.length < 2) { if (pts.length) pen = pts[0]; continue; }
      c.strokeStyle = this.ink; c.globalAlpha = s.kind === 'ruler' ? 0.45 : 0.85; c.lineWidth = s.kind === 'ruler' ? 0.8 : 1.15; c.setLineDash(s.kind === 'ruler' ? [2, 3] : []);
      c.beginPath(); pts.forEach(([x, y], j) => (j ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); pen = pts[pts.length - 1];
    }
    c.setLineDash([]); c.globalAlpha = 1; return pen;
  }
  knots(c: CanvasRenderingContext2D, d: Drawn, upto: number) {
    const ks = d.events.filter((e) => e.k === 'knot' && e.pt <= upto); c.fillStyle = this.gold;
    d.knots.forEach(([x, y], i) => { if (i < ks.length || upto >= d.n) { c.beginPath(); c.arc(x, y, 1.9, 0, Math.PI * 2); c.fill(); } });
  }
  signet(c: CanvasRenderingContext2D, d: Drawn, p: number) {   // the author's signature, stamped at the end of the walk
    const n = Math.max(2, Math.round(d.signet.length * p)); c.strokeStyle = this.gold; c.lineWidth = 1.3; c.beginPath(); d.signet.slice(0, n).forEach(([x, y], j) => (j ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
  }
  full(c: CanvasRenderingContext2D, x: { mark: Mark; d: Drawn }) { this.thread(c, x); this.strokes(c, x.d, x.d.n); this.knots(c, x.d, x.d.n); this.signet(c, x.d, 1); }
  paintBase(upToExclusive: number) {   // everything already finished, drawn once and kept
    const c = this.bctx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.base.width, this.base.height); this.place(c); this.mark0(c);
    for (let k = 0; k < upToExclusive; k++) this.full(c, this.drawn[k]);
  }
  composite(): CanvasRenderingContext2D { const c = this.ctx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.canvas.width, this.canvas.height); c.drawImage(this.base, 0, 0); return c; }
  // ---- the time-lapse
  replay() { this.from = 0; this.paintBase(0); this.run(); }
  run() {
    cancelAnimationFrame(this.raf); this.replayBtn.hidden = true;
    if (reduced || !this.drawn.length) { this.finish(); return; }
    const n = this.drawn.length - this.from, budget = 9000;
    this.durs = this.drawn.map((x) => Math.max(120, Math.min(1700, Math.sqrt(x.mark.shape.typed) * 34, budget / Math.max(1, n))));
    this.i = this.from; this.phase = 'walk'; this.t0 = performance.now() + 250; this.glyphs = []; this.evDone = 0;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }
  finish() {
    cancelAnimationFrame(this.raf); this.phase = 'done'; this.paintBase(this.drawn.length); this.composite(); this.kctx.clearRect(0, 0, this.keysCv.width, this.keysCv.height);
    this.replayBtn.hidden = reduced; this.now.textContent = this.summary(this.drawn.length ? this.drawn[this.drawn.length - 1].mark : null);
  }
  summary(m: Mark | null) {
    if (!m) return 'The Book is empty. The first mark will draw itself here.';
    const s = m.shape; return `${m.sample ? 'Sample · ' : ''}No. ${m.seq} · ${fmt(s.typed)} typed${s.pasted ? ` · ${fmt(s.pasted)} pasted` : ''} · ${fmt(s.deletions)} deleted · ${s.pauses} pauses · ${s.forgiveness} slips forgiven`;
  }
  frame(t: number) {
    if (this.phase === 'done' || this.phase === 'idle') return;
    const x = this.drawn[this.i], d = x.d, dur = this.durs[this.i];
    if (t < this.t0) { this.raf = requestAnimationFrame((u) => this.frame(u)); return; }
    const el = t - this.t0, walk = Math.min(1, el / dur), upto = walk * d.n, c = this.composite(); this.place(c);
    this.thread(c, x); const pen = this.strokes(c, d, upto); this.knots(c, d, upto);
    if (this.phase === 'walk') {
      c.fillStyle = this.gold; c.globalAlpha = 0.25; c.beginPath(); c.arc(pen[0], pen[1], 5.5, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1; c.beginPath(); c.arc(pen[0], pen[1], 2.6, 0, Math.PI * 2); c.fill();
      this.keyStream(d, upto);
      this.now.textContent = `${x.mark.sample ? 'Sample · ' : ''}No. ${x.mark.seq} · typed ×${Math.max(2, Math.round((x.mark.shape.active_s * 1000) / dur))} speed · real session ${mins(x.mark.shape.active_s)}`;
      if (walk >= 1) { this.phase = 'sign'; this.t0 = t; }
    } else {   // sign: the author's signet is drawn in, then the mark is kept
      const sp = Math.min(1, el / 380); this.signet(c, d, sp); this.knots(c, d, d.n);
      if (sp >= 1) { this.paintBase(this.i + 1); this.now.textContent = this.summary(x.mark); this.i++; this.glyphs = []; this.evDone = 0;
        if (this.i >= this.drawn.length) { this.phase = 'done'; this.composite(); this.replayBtn.hidden = false; this.sweepKeys(); return; }
        this.phase = 'walk'; this.t0 = t + 120; }
    }
    this.raf = requestAnimationFrame((u) => this.frame(u));
  }
  sweepKeys() { this.kctx.clearRect(0, 0, this.keysCv.width, this.keysCv.height); }
  keyStream(d: Drawn, upto: number) {
    const ev = d.events; while (this.evDone < ev.length && ev[this.evDone].pt <= upto) { const e = ev[this.evDone++]; const cnt = e.k === 'char' ? Math.min(6, Math.max(1, Math.round((e.n ?? 1) / 4))) : 1; for (let q = 0; q < cnt; q++) this.glyphs.push(e.k); }
    if (this.glyphs.length > 160) this.glyphs.splice(0, this.glyphs.length - 160);
    const k = this.kctx, W = this.keysCv.width, H = this.keysCv.height, u = this.dpr; k.setTransform(1, 0, 0, 1, 0, 0); k.clearRect(0, 0, W, H); k.lineCap = 'round';
    const step = 7 * u, mid = H / 2; let x = W - 4 * u;
    for (let g = this.glyphs.length - 1; g >= 0 && x > 0; g--, x -= step) {
      const kind = this.glyphs[g], a = Math.max(0.15, 1 - (this.glyphs.length - 1 - g) / 160);
      k.globalAlpha = a; k.fillStyle = this.ink; k.strokeStyle = this.ink;
      if (kind === 'char') { k.beginPath(); k.arc(x, mid, 1.7 * u, 0, Math.PI * 2); k.fill(); }
      else if (kind === 'back') { k.strokeStyle = this.bad; k.lineWidth = 1.4 * u; k.beginPath(); k.moveTo(x + 2.5 * u, mid - 3 * u); k.lineTo(x - 2.5 * u, mid); k.lineTo(x + 2.5 * u, mid + 3 * u); k.stroke(); }
      else if (kind === 'pause') { k.strokeStyle = this.faint; k.lineWidth = 1.2 * u; k.strokeRect(x - 2.5 * u, mid - 4 * u, 5 * u, 8 * u); }
      else if (kind === 'paste') { k.strokeStyle = this.ink; k.lineWidth = 1 * u; k.setLineDash([2 * u, 2 * u]); k.strokeRect(x - 3 * u, mid - 4 * u, 6 * u, 8 * u); k.setLineDash([]); }
      else { k.fillStyle = this.gold; k.beginPath(); k.arc(x, mid, 3 * u, 0, Math.PI * 2); k.fill(); }
    }
    k.globalAlpha = 1;
  }
  // ---- hover: who signed it, when, and what it is anchored to
  hover() {
    const tip = $('#tip'), stage = $('.stage');
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.phase === 'walk' || this.phase === 'sign') { tip.hidden = true; return; }
      const rect = this.canvas.getBoundingClientRect(); const x = e.clientX - (rect.left + rect.width / 2), y = e.clientY - (rect.top + rect.height / 2);
      const rot = this.spinAnim ? ((Number(this.spinAnim.currentTime) || 0) / 1000) * 0.006 : 0, a = -(this.spin + rot); const lx = x * Math.cos(a) - y * Math.sin(a), ly = x * Math.sin(a) + y * Math.cos(a);
      let best: { m: Mark; dist: number } | null = null;
      for (const { mark, d } of this.drawn) { const dist = Math.hypot(d.signetAt[0] - lx, d.signetAt[1] - ly); const d2 = Math.hypot(d.at[0] - lx, d.at[1] - ly); const dd = Math.min(dist, d2); if (!best || dd < best.dist) best = { m: mark, dist: dd }; }
      if (best && best.dist < 28) {
        const m = best.m, sr = stage.getBoundingClientRect(); tip.hidden = false; tip.style.left = `${Math.min(sr.width - 250, e.clientX - sr.left + 12)}px`; tip.style.top = `${e.clientY - sr.top + 12}px`;
        const who = m.key ? `signed by key ${m.key.slice(0, 8)}…` : 'unsigned';
        const anchor = m.sample ? 'sample, not a real inscription' : m.anchor_height ? `fixed in Bitcoin block ${m.anchor_height}` : 'anchored in Bitcoin';
        tip.textContent = `${m.sample ? 'Sample ' : ''}No. ${m.seq} · ${who} · ${anchor} · ${fmt(m.shape.typed)} typed, ${fmt(m.shape.deletions)} deleted, ${m.shape.pauses} pauses, ${m.shape.forgiveness} slips forgiven`;
        this.canvas.style.cursor = 'default';
      } else { tip.hidden = true; }
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
let asking: { cert: any; ots: Uint8Array } | null = null;
const parts: { cert?: any; ots?: Uint8Array; rec?: any; certs: Map<string, any>; proofs: Uint8Array[] } = { certs: new Map(), proofs: [] };
const proofFor = (c: any) => parts.proofs.find((p) => { try { return readOts(p).file_digest === anchorDigestHex(c); } catch { return false; } });
const pickPrimary = () => { const all = [...parts.certs.values()]; parts.cert = all.sort((a, b) => String(b.created_utc).localeCompare(String(a.created_utc)))[0]; parts.ots = parts.cert ? proofFor(parts.cert) : undefined; };
let book: Book;

const b64 = (u: Uint8Array) => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const OTS_MAGIC = [0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73];
async function take(f: File) {
  const b = new Uint8Array(await f.arrayBuffer());
  if (OTS_MAGIC.every((x, i) => b[i] === x)) { parts.proofs.push(b); pickPrimary(); return; }
  try {
    const j = JSON.parse(new TextDecoder().decode(b));
    if (j?.schema === 'merit-recognition/0.1') parts.rec = j;
    else { parts.certs.set(j?.id ?? String(parts.certs.size), j); pickPrimary(); $<HTMLTextAreaElement>('#cert').value = JSON.stringify(parts.cert, null, 2); }
  } catch { /* ignore unknown files */ }
}

function line(ok: boolean | null, text: string) {
  const li = document.createElement('li'); li.dataset.state = ok === null ? 'wait' : ok ? 'ok' : 'bad';
  li.textContent = `${ok === null ? '…' : ok ? '✓' : '✗'}  ${text}`; return li;
}

let seqCheck = 0;
async function qualify() {
  const my = ++seqCheck;
  const out = $('#result'); const list = $('#checks'); const ins = $<HTMLButtonElement>('#inscribe');
  pending = null; ins.disabled = true; $<HTMLInputElement>('#consent').checked = false; $('#consent-row').hidden = true; list.replaceChildren();
  const c = parts.cert;
  if (!c) { out.textContent = ''; delete out.dataset.state; return; }
  let signed = false;
  try { signed = c.schema === 'merit-attestation/0.1' && c.id === attestationId(bodyOf(c)) && verifySignature(c); } catch { /* malformed */ }
  if (!signed) { out.dataset.state = 'bad'; out.textContent = 'This certificate does not verify.'; return; }
  const s = shapeOf(c); const mins = Math.max(1, Math.round(s.active_s / 60));
  out.dataset.state = 'ok';
  out.textContent = `Verifies. Signed by ${c.author.public_key.slice(0, 12)}… · ${s.typed} characters typed, ${s.pasted} pasted · ${s.deletions} deletions · ${s.forgiveness} slips forgiven · ${mins} active ${mins === 1 ? 'minute' : 'minutes'}.`;

  const floor = workFloor(c);
  list.append(line(!floor, floor ? `Real work: needs ${floor}` : `Real work: ${s.typed} characters, mostly typed`));

  let anchored: boolean | null = false; let anchorText = 'Anchored in Bitcoin: add the certificate’s .ots proof';
  if (parts.ots) {
    const claims = anchorClaim(c, parts.ots);
    if (typeof claims === 'string') anchorText = `Anchored in Bitcoin: ${claims}`;
    else {
      anchored = null; anchorText = `Anchored in Bitcoin: checking block ${claims[0].height}…`;
      const li = line(null, anchorText); list.append(li);
      let ok = false, h = 0;
      for (const cl of claims) { try { if ((await blockMerkleRoot(cl.height)) === cl.root) { ok = true; h = cl.height; break; } } catch { /* offline */ } }
      if (my !== seqCheck) return;
      anchored = ok; li.replaceWith(line(ok, ok ? `Anchored in Bitcoin: block ${h}` : 'Anchored in Bitcoin: could not confirm against the block (it will be checked again on inscribe)'));
      if (!ok) anchored = null;
    }
  }
  if (anchored === false) list.append(line(false, anchorText));

  const founder = book.founder ?? FOUNDER;
  let recOk = false;
  if (c.author.public_key === founder) { recOk = true; list.append(line(true, 'Entry: founding recognizer')); }
  else if (parts.rec) {
    const rc = recognitionClaim(c, parts.rec, founder);
    let text = 'Entry by recognition: ';
    if (rc) text += rc;
    else {
      const r = parts.rec.recognizer as string; const m = book.marks.find((x) => x.key && r.startsWith(x.key));
      if (r === founder) { recOk = true; text += 'by the founding recognizer'; }
      else if (m) { recOk = true; text += `by the author of Mark ${m.seq}`; }
      else text += 'the recognizer is not in the Book yet';
    }
    list.append(line(recOk, text));
  } else {
    // Earned by time: own certificates, each anchored, spanning about a week of blocks.
    const mine = [...parts.certs.values()].filter((x) => x?.author?.public_key === c.author.public_key && !workFloor(x));
    const heights: number[] = [];
    for (const x of mine) { const p = proofFor(x); if (!p) continue; const a = anchorClaim(x, p); if (typeof a !== 'string') heights.push(a[0].height); }
    const span = heights.length ? Math.max(...heights) - Math.min(...heights) : 0;
    recOk = heights.length >= EARN.certificates && span >= EARN.span_blocks;
    list.append(line(recOk, recOk
      ? `Entry earned by time: ${heights.length} anchored certificates over about ${Math.round(span / 144)} days`
      : `Entry: a recognition, or earn it by time with ${EARN.certificates} of your own anchored certificates over about 7 days (you have ${heights.length} over ${Math.round(span / 144)} days)`));
  }

  if (!floor && anchored !== false && recOk) { pending = c; $('#consent-row').hidden = false; }
  // Real work and anchored, but no one has recognized it yet: offer the waiting list.
  const askRow = $('#ask-row'); askRow.hidden = true;
  if (!floor && anchored === true && !recOk && parts.ots && c.author.public_key !== founder) { askRow.hidden = false; asking = { cert: c, ots: parts.ots }; }
}

async function main() {
  { const ico = document.getElementById('sig-ico'); if (ico) ico.setAttribute('d', signetShape('3fa9c1d2e4b5').map(([x, y], i) => `${i ? 'L' : 'M'}${(x * 11).toFixed(1)} ${(y * 11).toFixed(1)}`).join('') + 'Z'); }
  book = await fetch('/api/book').then((r) => r.json());
  fetch('/api/requests').then((r) => r.json()).then((w: unknown[]) => { if (w.length) $('#status').textContent += ` · ${w.length} waiting for recognition`; }).catch(() => {});
  const view = new BookView($('#book'), book); status(book);
  const ta = $<HTMLTextAreaElement>('#cert');
  ta.addEventListener('input', () => { parts.certs.clear(); try { const j = JSON.parse(ta.value); parts.certs.set(j?.id ?? '0', j); } catch { if (ta.value.trim()) parts.certs.set('0', {}); } pickPrimary(); qualify(); });
  const file = $<HTMLInputElement>('#file');
  file.addEventListener('change', async () => { for (const f of Array.from(file.files ?? [])) await take(f); qualify(); });
  const drop = $('#drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.dataset.over = '1'; });
  drop.addEventListener('dragleave', () => delete drop.dataset.over);
  drop.addEventListener('drop', async (e) => { e.preventDefault(); delete drop.dataset.over; for (const f of Array.from(e.dataTransfer?.files ?? [])) await take(f); qualify(); });
  $<HTMLInputElement>('#consent').addEventListener('change', (e) => ($<HTMLButtonElement>('#inscribe').disabled = !(e.target as HTMLInputElement).checked || !pending));
  $<HTMLInputElement>('#ask-consent').addEventListener('change', (e) => ($<HTMLButtonElement>('#ask').disabled = !(e.target as HTMLInputElement).checked || !asking));
  $<HTMLButtonElement>('#ask').addEventListener('click', async () => {
    if (!asking) return;
    const btn = $<HTMLButtonElement>('#ask'); btn.disabled = true;
    const r = await fetch('/api/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ certificate: asking.cert, ots: b64(asking.ots), consent: true }) }).then((x) => x.json()).catch(() => ({ ok: false, reason: 'network error' }));
    const out = $('#result');
    if (!r.ok) { out.dataset.state = 'bad'; out.textContent = `Not added: ${r.reason}.`; btn.disabled = false; return; }
    out.dataset.state = 'ok';
    out.textContent = r.already ? 'Already waiting for recognition.' : 'You are on the waiting list. When someone in the Book recognizes this certificate, it is inscribed automatically.';
    $('#ask-row').hidden = true;
  });
  $<HTMLButtonElement>('#inscribe').addEventListener('click', async () => {
    if (!pending) return;
    const btn = $<HTMLButtonElement>('#inscribe'); btn.disabled = true;
    const r = await fetch('/api/inscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ certificate: pending, ots: b64(parts.ots!), recognition: parts.rec,
      history: parts.rec ? [] : [...parts.certs.values()].filter((x) => x.id !== pending.id && x?.author?.public_key === pending.author.public_key).flatMap((x) => { const p = proofFor(x); return p ? [{ certificate: x, ots: b64(p) }] : []; }), consent: true }) }).then((x) => x.json()).catch(() => ({ ok: false, reason: 'network error' }));
    const out = $('#result');
    if (!r.ok) { out.dataset.state = 'bad'; out.textContent = `Not inscribed: ${r.reason}.`; btn.disabled = false; return; }
    if (r.already) { out.textContent = `Already in the Book as No. ${r.seq}.`; return; }
    view.add({ seq: r.seq, id: pending.id, key: pending.author.public_key.slice(0, 12), created_utc: pending.created_utc, chain: r.chain, shape: shapeOf(pending), by_seq: r.by_seq, anchor_height: r.anchor_height });
    status(view.book);
    out.textContent = `Inscribed as No. ${r.seq}. The Book now reads ${r.chain.slice(0, 12)}…`;
    document.getElementById('top')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    pending = null;
  });
}
main();
