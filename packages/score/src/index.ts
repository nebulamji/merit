import type { Metrics } from '@merit/spec';

/**
 * Scoring standards live here, separate from certificates (see docs/GOVERNANCE.md).
 * A standard reads raw metrics from a certificate; it never changes the certificate.
 */

export const COMPOSITION_STANDARD = 'composition/0.2-experimental' as const;

export interface CompositionResult {
  standard: typeof COMPOSITION_STANDARD;
  /** 0..1: how much the process looks like composing here, as opposed to retyping text from elsewhere */
  score: number;
  label: 'composed' | 'mixed' | 'transcription-like' | 'insufficient';
  signals: { planning: number; revision: number; unsteadiness: number; boundary_pauses: number; rework: number; thinking_breaks: number; typed_share: number };
  note: string;
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Composing vs transcribing (experimental, uncalibrated).
 * Composing shows planning pauses before words, revision, uneven rhythm, and long pauses at boundaries.
 * Retyping someone else's text tends to be steadier with little revision.
 * Evidence of a process shape, never proof of authorship; calibration on volunteers is required before claims.
 */
export function compositionScore(m: Metrics): CompositionResult {
  const r = m.rhythm;
  const base = { standard: COMPOSITION_STANDARD, note: 'Experimental and uncalibrated. Evidence of a process shape, not proof of authorship.' };
  if (!r || r.words < 50) {
    return { ...base, score: 0, label: 'insufficient', signals: { planning: 0, revision: 0, unsteadiness: 0, boundary_pauses: 0, rework: 0, thinking_breaks: 0, typed_share: m.typed_share } };
  }
  // v0.2: fluent writers barely pause between words, so word-level planning is down-weighted;
  // composition shows up as rework (deleting and redoing), uneven rhythm, and thinking breaks at boundaries.
  const planning = clamp((r.planning_ratio - 1.5) / 4.5);
  const revision = clamp(r.revisions_per_100_words / 8);
  const unsteadiness = clamp((r.iki_cv - 0.3) / 0.7);
  const boundary_pauses = r.boundary_pause_share;
  const rework = clamp((r.deletions_per_100_chars ?? 0) / 10);
  const thinking_breaks = clamp((r.long_pauses_per_100_words ?? 0) / 5);
  const score = r3(m.typed_share * (0.15 * planning + 0.2 * revision + 0.2 * unsteadiness + 0.15 * boundary_pauses + 0.2 * rework + 0.1 * thinking_breaks));
  const label = score >= 0.5 ? 'composed' : score >= 0.3 ? 'mixed' : 'transcription-like';
  return { ...base, score, label, signals: { planning: r3(planning), revision: r3(revision), unsteadiness: r3(unsteadiness), boundary_pauses: r3(boundary_pauses), rework: r3(rework), thinking_breaks: r3(thinking_breaks), typed_share: m.typed_share } };
}
