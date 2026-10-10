import { describe, expect, it } from 'vitest';
import type { MeritEvent } from '@merit/spec';
import { deriveMetrics, finalText, diff } from '@merit/capture';

/** Build a log by "typing" a script: helpers keep fixtures readable. */
function script() {
  const ev: MeritEvent[] = [];
  let t = 0, pos = 0, seq = 0, doc = '';
  const api = {
    type(s: string, msPerChar = 120) {
      for (const ch of s) { t += msPerChar; ev.push({ seq: seq++, t, kind: 'insert', pos, inserted: ch }); doc = doc.slice(0, pos) + ch + doc.slice(pos); pos++; }
      return api;
    },
    backspace(n: number, ms = 90) {
      for (let i = 0; i < n; i++) { t += ms; const r = doc[pos - 1]; ev.push({ seq: seq++, t, kind: 'delete_back', pos: pos - 1, removed: r }); doc = doc.slice(0, pos - 1) + doc.slice(pos); pos--; }
      return api;
    },
    paste(s: string) { t += 300; ev.push({ seq: seq++, t, kind: 'paste', pos, inserted: s }); doc = doc.slice(0, pos) + s + doc.slice(pos); pos += s.length; return api; },
    replace(start: number, end: number, s: string) { t += 400; ev.push({ seq: seq++, t, kind: 'replace', pos: start, removed: doc.slice(start, end), inserted: s }); doc = doc.slice(0, start) + s + doc.slice(end); pos = start + s.length; return api; },
    wait(ms: number) { t += ms; return api; },
    get events() { return ev; },
    get doc() { return doc; },
  };
  return api;
}

describe('replay', () => {
  it('reconstructs the final text exactly', () => {
    const s = script().type('The cymbal').backspace(2).type('al rings.').paste(' Quote here.');
    expect(finalText(s.events)).toBe(s.doc);
  });
});

describe('deriveMetrics', () => {
  it('counts a typo fix, a word change, and a paste', () => {
    const s = script()
      .type('teh').backspace(2).type('he ')      // typo fix: removed "eh"
      .type('angry ').backspace(6).type('bold ')  // word change: removed "angry "
      .wait(3000)                                 // a real pause
      .paste('pasted words');
    const m = deriveMetrics(s.events);
    expect(m.corrections.typo_fixes).toBe(1);
    expect(m.corrections.word_changes).toBe(1);
    expect(m.corrections.deletions).toBe(8);
    expect(m.paste_events).toBe(1);
    expect(m.chars_pasted).toBe(12);
    expect(m.max_paste_len).toBe(12);
    expect(m.pauses_over_2s).toBe(1);
    expect(m.final_chars).toBe(s.doc.length);
    // "the bold " typed (9) + "pasted words" pasted (12)
    expect(m.typed_share).toBeCloseTo(9 / 21, 3);
  });

  it('counts a selection overwrite as a revision and classifies a restructure', () => {
    const s = script().type('First sentence. Second sentence here.');
    s.replace(0, 16, 'Opening line. ');
    const m = deriveMetrics(s.events);
    expect(m.revisions).toBe(1);
    expect(m.corrections.restructures).toBe(1);
    expect(finalText(s.events)).toBe('Opening line. Second sentence here.');
  });

  it('a fully pasted document has typed_share 0', () => {
    const m = deriveMetrics(script().paste('All of this came from somewhere else.').events);
    expect(m.typed_share).toBe(0);
    expect(m.chars_typed).toBe(0);
  });

  it('counts bursts split by gaps of a second or more', () => {
    const m = deriveMetrics(script().type('one').wait(1500).type('two').events);
    expect(m.bursts).toBe(2);
  });
});

describe('diff', () => {
  it('finds the single changed span', () => {
    expect(diff('hello world', 'hello brave world')).toEqual({ pos: 6, removed: '', inserted: 'brave ' });
    expect(diff('abcdef', 'abXef')).toEqual({ pos: 2, removed: 'cd', inserted: 'X' });
  });
});
