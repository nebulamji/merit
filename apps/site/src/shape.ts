import type { MeritAttestation } from '@merit/spec';

/** The only numbers the artwork reads. All come from the certificate the author chose to inscribe. */
export interface Shape {
  typed: number; pasted: number; deletions: number; typo_fixes: number; word_changes: number;
  bursts: number; pauses: number; forgiveness: number; active_s: number;
}

export function shapeOf(c: MeritAttestation): Shape {
  const m = c.metrics as any;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0);
  return {
    typed: n(m.chars_typed), pasted: n(m.chars_pasted), deletions: n(m.corrections?.deletions),
    typo_fixes: n(m.corrections?.typo_fixes), word_changes: n(m.corrections?.word_changes),
    bursts: n(m.bursts), pauses: n(m.pauses_over_2s), forgiveness: n(m.forgiveness), active_s: n((m.active_ms ?? 0) / 1000),
  };
}
