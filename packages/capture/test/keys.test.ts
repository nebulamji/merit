import { describe, expect, it } from 'vitest';
import type { KeyClass, KeyEvent } from '@merit/spec';
import { deriveKeyMetrics, deriveMetrics } from '@merit/capture';

function keys() {
  const ev: KeyEvent[] = [];
  let t = 0, seq = 0;
  const api = {
    press(k: KeyClass, times = 1, ms = 110, n?: number) { for (let i = 0; i < times; i++) { t += ms; ev.push({ seq: seq++, t, k, ...(n ? { n } : {}) }); } return api; },
    type(count: number) { return api.press('char', count); },
    wait(ms: number) { t += ms; return api; },
    get events() { return ev; },
  };
  return api;
}

describe('deriveKeyMetrics', () => {
  it('classifies correction runs by length and counts no characters', () => {
    const k = keys()
      .type(10).press('back', 2).type(3)        // typo fix (2)
      .type(8).press('back', 6).type(5)         // word change (6)
      .type(4).press('back', 45).type(2);       // restructure (45)
    const m = deriveKeyMetrics(k.events);
    expect(m.source).toBe('keys');
    expect(m.corrections).toEqual({ deletions: 53, typo_fixes: 1, word_changes: 1, restructures: 1 });
    expect(m.chars_typed).toBe(32);
  });

  it('forgiveness: a slip absorbed (typing resumes) vs abandoned (long stop)', () => {
    const absorbed = deriveKeyMetrics(keys().type(5).press('back', 2).type(3).events);
    expect(absorbed.forgiveness).toBe(1);
    const abandoned = deriveKeyMetrics(keys().type(5).press('back', 2).wait(9000).type(3).events);
    expect(abandoned.forgiveness).toBe(0);
    const half = deriveKeyMetrics(keys().type(5).press('back', 1).type(2).press('back', 1).wait(9000).type(2).events);
    expect(half.forgiveness).toBe(0.5);
  });

  it('select then type is a revision; paste counts its length', () => {
    const m = deriveKeyMetrics(keys().type(20).press('select').type(4).press('paste', 1, 200, 50).events);
    expect(m.revisions).toBe(1);
    expect(m.paste_events).toBe(1);
    expect(m.chars_pasted).toBe(50);
    expect(m.typed_share).toBeCloseTo(24 / 74, 3);
  });
});

describe('content forgiveness', () => {
  it('matches the key-level definition on the same behavior', () => {
    const m = deriveMetrics([
      { seq: 0, t: 100, kind: 'insert', pos: 0, inserted: 'a' },
      { seq: 1, t: 200, kind: 'insert', pos: 1, inserted: 'b' },
      { seq: 2, t: 300, kind: 'delete_back', pos: 1, removed: 'b' },
      { seq: 3, t: 400, kind: 'insert', pos: 1, inserted: 'c' },
    ]);
    expect(m.forgiveness).toBe(1);
    expect(m.source).toBe('content');
  });
});
