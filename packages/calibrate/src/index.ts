import type { Metrics } from '@merit/spec';
import { compositionScore, COMPOSITION_STANDARD } from '@merit/score';

/**
 * Calibration of a scoring standard against labeled sessions (docs/CALIBRATION.md).
 * A standard may not be described as accurate until this report says `claimable: true`.
 *
 * Positive class = composed. Two errors matter, and they are not symmetric:
 *  - false accusation: a composed session the standard does not call composed (harms an honest person)
 *  - false pass: a retyped session the standard calls composed (lets a copy through)
 */

export type CalLabel = 'composed' | 'retyped' | 'ai-retyped';
export const CAL_LABELS: readonly CalLabel[] = ['composed', 'retyped', 'ai-retyped'];

export interface Sample { id: string; participant: string; label: CalLabel; metrics: Metrics; task?: string }

export interface Rate { k: number; n: number; rate: number | null; lo: number | null; hi: number | null }
export interface CalibrationReport {
  standard: string;
  sessions: Record<CalLabel, number>;
  participants: number;
  insufficient: number;
  threshold: number;
  false_accusation: Rate;
  false_pass: Rate;
  false_pass_ai: Rate;
  auc: number | null;
  equal_error_rate: { threshold: number; rate: number } | null;
  sweep: { threshold: number; false_accusation: number | null; false_pass: number | null }[];
  claimable: boolean;
  reasons: string[];
  note: string;
}

/** Minimums before any accuracy claim (GOVERNANCE.md). */
export const MIN_SESSIONS_PER_CLASS = 30;
export const MIN_PARTICIPANTS = 10;

const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Wilson score interval, 95%. */
export function wilson(k: number, n: number, z = 1.96): Rate {
  if (n === 0) return { k, n, rate: null, lo: null, hi: null };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { k, n, rate: r4(p), lo: r4(Math.max(0, c - h)), hi: r4(Math.min(1, c + h)) };
}

/** Probability a random composed session outscores a random retyped one (ties count half). */
export function auc(pos: number[], neg: number[]): number | null {
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const p of pos) for (const q of neg) s += p > q ? 1 : p === q ? 0.5 : 0;
  return r4(s / (pos.length * neg.length));
}

export function calibrate(samples: Sample[], threshold = 0.5, score = (m: Metrics) => compositionScore(m)): CalibrationReport {
  const sessions = { composed: 0, retyped: 0, 'ai-retyped': 0 } as Record<CalLabel, number>;
  const scored: { label: CalLabel; s: number }[] = [];
  let insufficient = 0;
  for (const x of samples) {
    sessions[x.label]++;
    const r = score(x.metrics);
    if (r.label === 'insufficient') { insufficient++; continue; }
    scored.push({ label: x.label, s: r.score });
  }
  const of = (l: CalLabel) => scored.filter((x) => x.label === l).map((x) => x.s);
  const comp = of('composed'), ret = of('retyped'), ai = of('ai-retyped');
  const below = (xs: number[], t: number) => xs.filter((s) => s < t).length;
  const atOrAbove = (xs: number[], t: number) => xs.filter((s) => s >= t).length;
  const sweep = Array.from({ length: 21 }, (_, i) => i / 20).map((t) => ({
    threshold: t,
    false_accusation: comp.length ? r4(below(comp, t) / comp.length) : null,
    false_pass: ret.length ? r4(atOrAbove(ret, t) / ret.length) : null,
  }));
  let eer: CalibrationReport['equal_error_rate'] = null;
  const both = sweep.filter((x) => x.false_accusation !== null && x.false_pass !== null);
  if (both.length) {
    const best = both.reduce((a, b) => (Math.abs(a.false_accusation! - a.false_pass!) <= Math.abs(b.false_accusation! - b.false_pass!) ? a : b));
    eer = { threshold: best.threshold, rate: r4((best.false_accusation! + best.false_pass!) / 2) };
  }
  const participants = new Set(samples.map((x) => x.participant)).size;
  const reasons: string[] = [];
  if (comp.length < MIN_SESSIONS_PER_CLASS) reasons.push(`composed sessions ${comp.length} < ${MIN_SESSIONS_PER_CLASS}`);
  if (ret.length < MIN_SESSIONS_PER_CLASS) reasons.push(`retyped sessions ${ret.length} < ${MIN_SESSIONS_PER_CLASS}`);
  if (participants < MIN_PARTICIPANTS) reasons.push(`participants ${participants} < ${MIN_PARTICIPANTS}`);
  return {
    standard: COMPOSITION_STANDARD,
    sessions, participants, insufficient, threshold,
    false_accusation: wilson(below(comp, threshold), comp.length),
    false_pass: wilson(atOrAbove(ret, threshold), ret.length),
    false_pass_ai: wilson(atOrAbove(ai, threshold), ai.length),
    auc: auc(comp, ret),
    equal_error_rate: eer,
    sweep,
    claimable: reasons.length === 0,
    reasons,
    note: 'Intervals treat sessions as independent; sessions from one participant are correlated, so true uncertainty is wider. Error rates hold only for the population and tasks sampled.',
  };
}

const pct = (r: Rate) => (r.rate === null ? 'n/a' : `${(r.rate * 100).toFixed(1)}% (${r.k}/${r.n}; 95% CI ${(r.lo! * 100).toFixed(1)}–${(r.hi! * 100).toFixed(1)}%)`);

export function reportMarkdown(r: CalibrationReport): string {
  return [
    `# Calibration report: ${r.standard}`,
    '',
    r.claimable ? '**Claimable.** Error rates below may be published with this report.' : `**Not claimable.** ${r.reasons.join('; ')}. Do not describe this standard as accurate.`,
    '',
    `Sessions: composed ${r.sessions.composed}, retyped ${r.sessions.retyped}, AI-retyped ${r.sessions['ai-retyped']} · participants ${r.participants} · too short to score ${r.insufficient}`,
    '',
    `At threshold ${r.threshold}:`,
    `- False accusation (composed, not called composed): ${pct(r.false_accusation)}`,
    `- False pass (retyped, called composed): ${pct(r.false_pass)}`,
    `- False pass on retyped AI output: ${pct(r.false_pass_ai)}`,
    `- AUC: ${r.auc ?? 'n/a'} · equal error rate: ${r.equal_error_rate ? `${(r.equal_error_rate.rate * 100).toFixed(1)}% at ${r.equal_error_rate.threshold}` : 'n/a'}`,
    '',
    `_${r.note}_`,
    '',
  ].join('\n');
}
