import { describe, expect, it } from 'vitest';
import { calibrate, wilson, auc, reportMarkdown, type Sample } from '@merit/calibrate';
import { deriveKeyMetrics } from '@merit/capture';
import type { KeyEvent } from '@merit/spec';

// Deterministic synthetic streams. These test the arithmetic only; they are NOT calibration data.
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function stream(kind: 'composing' | 'retyping', seed: number, words = 120): KeyEvent[] {
  const r = rng(seed); const out: KeyEvent[] = []; let t = 0; let seq = 0;
  const push = (k: KeyEvent['k'], gap: number) => { t += Math.round(gap); out.push({ seq: seq++, t, k } as KeyEvent); };
  for (let w = 0; w < words; w++) {
    const len = 3 + Math.floor(r() * 6);
    const pre = kind === 'composing' ? (r() < 0.12 ? 2500 + r() * 4000 : 150 + r() * 600) : 120 + r() * 60;
    for (let i = 0; i < len; i++) push('char', i === 0 ? pre : kind === 'composing' ? 60 + r() * 260 : 95 + r() * 30);
    if (kind === 'composing' && r() < 0.25) { const d = 1 + Math.floor(r() * 4); for (let i = 0; i < d; i++) push('back', 120); for (let i = 0; i < d; i++) push('char', 140 + r() * 200); }
    if (w % 12 === 11) push('punct', kind === 'composing' ? 200 : 110);
    push('space', kind === 'composing' ? 90 + r() * 120 : 100);
  }
  return out;
}
const sample = (label: Sample['label'], i: number, p: string): Sample => ({ id: `${label}-${i}`, participant: p, label, metrics: deriveKeyMetrics(stream(label === 'composed' ? 'composing' : 'retyping', i * 7 + (label === 'composed' ? 1 : 2))) });

describe('statistics', () => {
  it('Wilson interval matches the textbook value for 0/30', () => {
    const w = wilson(0, 30);
    expect(w.rate).toBe(0); expect(w.lo).toBe(0); expect(w.hi).toBeCloseTo(0.1135, 3);
  });
  it('AUC is 1 for perfect separation, 0.5 for ties', () => {
    expect(auc([0.9, 0.8], [0.1, 0.2])).toBe(1);
    expect(auc([0.5], [0.5])).toBe(0.5);
  });
});

describe('calibrate', () => {
  it('refuses to be claimable with too little data', () => {
    const r = calibrate([sample('composed', 1, 'p1'), sample('retyped', 1, 'p1')]);
    expect(r.claimable).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/participants 1 < 10/);
    expect(reportMarkdown(r)).toMatch(/Not claimable/);
  });
  it('becomes claimable at the minimums and reports both error directions', () => {
    const s: Sample[] = [];
    for (let i = 0; i < 30; i++) { s.push(sample('composed', i, `p${i % 10}`)); s.push(sample('retyped', i, `p${i % 10}`)); }
    const r = calibrate(s);
    expect(r.claimable).toBe(true);
    expect(r.sessions).toMatchObject({ composed: 30, retyped: 30 });
    expect(r.false_accusation.n + r.false_pass.n + r.insufficient).toBe(60);
    expect(r.auc).not.toBeNull();
    expect(r.sweep).toHaveLength(21);
  });
  it('sessions under 50 words are counted as insufficient, not scored', () => {
    const short: Sample = { id: 's', participant: 'p', label: 'composed', metrics: deriveKeyMetrics(stream('composing', 3, 20)) };
    expect(calibrate([short]).insufficient).toBe(1);
  });
});
