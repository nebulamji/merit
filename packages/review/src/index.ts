/**
 * The "correct" function: offer, never impose.
 *
 * Suggestions are computed locally from the author's own text. Nothing is changed unless the author
 * accepts. Each decision becomes a ReviewEvent that records only the decision and the KIND of
 * correction — never the words — so the certificate learns which habits are slips (accepted) and
 * which are style (kept), by the author's own choice.
 */

export type CorrectionKind =
  | 'space_before_punct' // "word ." -> "word."
  | 'repeated_punct'     // "!!" / ".." -> one mark (ellipsis "..." is left alone)
  | 'multi_space'        // "a  b" -> "a b"
  | 'unbalanced_quote'   // an odd number of " in a line
  | 'doubled_quote';     // '""word' -> '"word'

export interface Suggestion {
  id: number;
  kind: CorrectionKind;
  /** offset into the text */
  pos: number;
  len: number;
  replacement: string;
}

export type Decision = 'accept' | 'keep';

/** The only thing that enters the event log: the decision and its kind. */
export interface ReviewEvent {
  seq: number;
  t: number;
  k: 'review';
  decision: Decision;
  kind: CorrectionKind;
}

export function suggest(text: string): Suggestion[] {
  const out: Suggestion[] = [];
  let id = 0;
  const add = (kind: CorrectionKind, pos: number, len: number, replacement: string) => out.push({ id: id++, kind, pos, len, replacement });

  for (const m of text.matchAll(/""(?=\S)/g)) add('doubled_quote', m.index!, 2, '"');
  for (const m of text.matchAll(/(\S) +([.,!?;:])(?=\s|$)/g)) {
    const spaceStart = m.index! + m[1].length;
    add('space_before_punct', spaceStart, m[0].length - m[1].length - 1, '');
  }
  for (const m of text.matchAll(/([!?,;:])\1+|(?<!\.)\.{2}(?!\.)|\.{4,}/g)) {
    // keep a proper ellipsis "..." as-is; ".." and "...." are flagged
    add('repeated_punct', m.index!, m[0].length, m[0][0] === '.' ? (m[0].length >= 4 ? '...' : '.') : m[0][0]);
  }
  for (const m of text.matchAll(/(?<=\S) {2,}(?=\S)/g)) add('multi_space', m.index!, m[0].length, ' ');
  const lines = text.split('\n');
  let off = 0;
  for (const line of lines) {
    const quotes = [...line.matchAll(/"/g)];
    if (quotes.length % 2 === 1) add('unbalanced_quote', off + quotes[quotes.length - 1].index!, 1, '"');
    off += line.length + 1;
  }
  // stable order, non-overlapping (first wins)
  out.sort((a, b) => a.pos - b.pos || a.id - b.id);
  const kept: Suggestion[] = [];
  let end = -1;
  for (const s of out) if (s.pos >= end) { kept.push(s); end = s.pos + Math.max(s.len, 1); }
  return kept.map((s, i) => ({ ...s, id: i }));
}

/** Apply only the accepted suggestions (right to left so offsets stay valid). */
export function applyDecisions(text: string, suggestions: Suggestion[], decisions: Map<number, Decision>): string {
  let out = text;
  for (const s of [...suggestions].sort((a, b) => b.pos - a.pos)) {
    if (decisions.get(s.id) === 'accept' && s.kind !== 'unbalanced_quote') {
      out = out.slice(0, s.pos) + s.replacement + out.slice(s.pos + s.len);
    }
  }
  return out;
}

export function reviewEvents(suggestions: Suggestion[], decisions: Map<number, Decision>, startSeq: number, t: number): ReviewEvent[] {
  return suggestions
    .filter((s) => decisions.has(s.id))
    .map((s, i) => ({ seq: startSeq + i, t, k: 'review' as const, decision: decisions.get(s.id)!, kind: s.kind }));
}

export interface ReviewCounts {
  offered: number;
  accepted: number;
  kept: number;
  /** per kind: how often the author keeps it (1 = always deliberate style) */
  kept_ratio_by_kind: Partial<Record<CorrectionKind, number>>;
}

export function reviewMetrics(events: ReviewEvent[]): ReviewCounts {
  const by: Partial<Record<CorrectionKind, { a: number; k: number }>> = {};
  let accepted = 0, kept = 0;
  for (const e of events) {
    const b = (by[e.kind] ??= { a: 0, k: 0 });
    if (e.decision === 'accept') { accepted++; b.a++; } else { kept++; b.k++; }
  }
  const kept_ratio_by_kind: ReviewCounts['kept_ratio_by_kind'] = {};
  for (const [k, v] of Object.entries(by)) kept_ratio_by_kind[k as CorrectionKind] = Math.round((v!.k / (v!.a + v!.k)) * 1000) / 1000;
  return { offered: events.length, accepted, kept, kept_ratio_by_kind };
}
