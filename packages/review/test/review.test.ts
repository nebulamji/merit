import { describe, expect, it } from 'vitest';
import { suggest, applyDecisions, reviewEvents, reviewMetrics, type Decision } from '@merit/review';

describe('suggest (offer, never impose)', () => {
  it("finds KB's real habits", () => {
    const text = 'it says ""recording instead of that . wow!! fine  ok..';
    const kinds = suggest(text).map((s) => s.kind);
    expect(kinds).toContain('doubled_quote');
    expect(kinds).toContain('space_before_punct');
    expect(kinds).toContain('repeated_punct');
    expect(kinds).toContain('multi_space');
  });

  it('leaves a proper ellipsis alone', () => {
    expect(suggest('and then... silence').filter((s) => s.kind === 'repeated_punct')).toEqual([]);
  });

  it('changes nothing unless the author accepts', () => {
    const text = 'wait .. what';
    const s = suggest(text);
    expect(applyDecisions(text, s, new Map())).toBe(text);
  });

  it('applies only accepted suggestions', () => {
    const text = 'yes !! and ""quotes';
    const s = suggest(text);
    const d = new Map<number, Decision>(s.map((x) => [x.id, x.kind === 'doubled_quote' ? 'accept' : 'keep']));
    expect(applyDecisions(text, s, d)).toBe('yes !! and "quotes');
  });
});

describe('review events record decisions, never words', () => {
  it('logs only decision + kind and computes keep ratios', () => {
    const text = 'a . b !! c ""d';
    const s = suggest(text);
    const d = new Map<number, Decision>(s.map((x) => [x.id, x.kind === 'repeated_punct' ? 'keep' : 'accept']));
    const ev = reviewEvents(s, d, 100, 5000);
    for (const e of ev) expect(Object.keys(e).sort()).toEqual(['decision', 'k', 'kind', 'seq', 't']);
    const m = reviewMetrics(ev);
    expect(m.offered).toBe(s.length);
    expect(m.kept_ratio_by_kind.repeated_punct).toBe(1);
    expect(m.kept_ratio_by_kind.doubled_quote).toBe(0);
  });
});
