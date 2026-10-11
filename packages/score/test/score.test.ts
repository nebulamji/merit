import { describe, expect, it } from 'vitest';
import type { KeyClass, KeyEvent } from '@merit/spec';
import { deriveKeyMetrics } from '@merit/capture';
import { compositionScore } from '@merit/score';

/** Deterministic pseudo-random so tests are stable. */
function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

function session(kind: 'compose' | 'transcribe', words = 80): KeyEvent[] {
  const r = rng(kind === 'compose' ? 7 : 11);
  const ev: KeyEvent[] = [];
  let t = 0, seq = 0;
  const push = (k: KeyClass, gap: number) => { t += gap; ev.push({ seq: seq++, t, k }); };
  for (let w = 0; w < words; w++) {
    const len = 3 + Math.floor(r() * 6);
    for (let c = 0; c < len; c++) {
      if (kind === 'compose') {
        // thinking before words, uneven rhythm inside them
        push('char', c === 0 ? 900 + r() * 2500 + (r() < 0.12 ? 3000 : 0) : 70 + r() * 260);
      } else {
        // steady copy-typing
        push('char', c === 0 ? 160 + r() * 60 : 120 + r() * 40);
      }
    }
    if (kind === 'compose' && r() < 0.12) { for (let i = 0; i < 6; i++) push('back', 90); for (let i = 0; i < 5; i++) push('char', 130); }
    push('space', kind === 'compose' ? 100 + r() * 200 : 120 + r() * 30);
  }
  return ev;
}

describe('composition/0.1-experimental', () => {
  it('scores composing above transcribing', () => {
    const c = compositionScore(deriveKeyMetrics(session('compose')));
    const t = compositionScore(deriveKeyMetrics(session('transcribe')));
    expect(c.score).toBeGreaterThan(t.score);
    expect(c.label).toBe('composed');
    expect(t.label).toBe('transcription-like');
  });
  it('refuses to score too little evidence', () => {
    expect(compositionScore(deriveKeyMetrics(session('compose', 30))).label).toBe('insufficient');
  });
  it('a fully pasted session cannot score as composed', () => {
    const m = deriveKeyMetrics([...session('compose', 80), { seq: 9999, t: 9e7, k: 'paste', n: 50000 }]);
    expect(compositionScore(m).score).toBeLessThan(0.3);
  });
});
