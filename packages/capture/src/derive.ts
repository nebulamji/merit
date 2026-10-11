import type { KeyEvent, MeritEvent, Metrics, RhythmStats, StyleCounts } from '@merit/spec';

const BURST_GAP_MS = 1000;
const ACTIVE_GAP_MS = 5000;
const PAUSE_MS = 2000;
const RECOVER_MS = 5000;

/** Character provenance in the replayed buffer: typed in-session or pasted. */
type Prov = 't' | 'p';

export interface Replay {
  text: string;
  prov: Prov[];
}

/**
 * Replay the event log into the final text, tracking where each surviving character came from.
 * Deterministic: the same log always yields the same text (predicate P2).
 */
export function replay(events: MeritEvent[], initial = ''): Replay {
  let chars = Array.from(initial);
  let prov: Prov[] = chars.map(() => 't');
  for (const e of events) {
    const removedLen = e.removed ? Array.from(e.removed).length : 0;
    const ins = e.inserted ? Array.from(e.inserted) : [];
    const tag: Prov = e.kind === 'paste' ? 'p' : 't';
    chars.splice(e.pos, removedLen, ...ins);
    prov.splice(e.pos, removedLen, ...ins.map(() => tag));
  }
  return { text: chars.join(''), prov };
}

const isDeletion = (e: MeritEvent) => e.kind === 'delete_back' || e.kind === 'delete_fwd' || e.kind === 'cut';
const WORD_RE = /[\p{L}\p{N}]{3,}/u;
const SENTENCE_RE = /[.!?]\s|\n/;

function classifyRemoval(removed: string): 'typo' | 'word' | 'restructure' {
  const n = Array.from(removed).length;
  if (n >= 40 || SENTENCE_RE.test(removed)) return 'restructure';
  if (WORD_RE.test(removed)) return 'word';
  return 'typo';
}

/**
 * Derive the public metrics (Layer 3) from the private log. Counts and shapes only.
 * Correction classes: a run of consecutive deletions (or a selection overwrite) is one correction,
 * classified by what it removed: typo (short fix), word change, or restructure (sentence or 40+ chars).
 */
export function deriveMetrics(events: MeritEvent[], initial = ''): Metrics {
  const { text, prov } = replay(events, initial);
  let chars_typed = 0, chars_pasted = 0, paste_events = 0, max_paste_len = 0;
  let deletions = 0, typo_fixes = 0, word_changes = 0, restructures = 0, revisions = 0;
  let bursts = 0, pauses_over_2s = 0, longest_pause_ms = 0, active_ms = 0;

  let runRemoved = '';
  let runs = 0, absorbed = 0, lastDelT = 0;
  const closeRun = (nextT?: number, resumed = false) => {
    if (!runRemoved) return;
    runs++;
    if (resumed && nextT !== undefined && nextT - lastDelT <= RECOVER_MS) absorbed++;
    const c = classifyRemoval(runRemoved);
    if (c === 'typo') typo_fixes++; else if (c === 'word') word_changes++; else restructures++;
    runRemoved = '';
  };

  let prevT: number | null = null;
  let inBurst = false;
  for (const e of events) {
    if (prevT !== null) {
      const gap = e.t - prevT;
      if (gap < ACTIVE_GAP_MS) active_ms += gap;
      if (gap > PAUSE_MS) pauses_over_2s++;
      if (gap > longest_pause_ms) longest_pause_ms = gap;
      if (gap >= BURST_GAP_MS) inBurst = false;
    }
    prevT = e.t;

    if (isDeletion(e)) {
      deletions++;
      // backspace runs remove right-to-left; keep reading order
      runRemoved = e.kind === 'delete_back' ? (e.removed ?? '') + runRemoved : runRemoved + (e.removed ?? '');
      lastDelT = e.t;
      inBurst = false;
      continue;
    }
    closeRun(e.t, e.kind === 'insert' || e.kind === 'replace');

    const insLen = e.inserted ? Array.from(e.inserted).length : 0;
    if (e.kind === 'paste') {
      paste_events++;
      chars_pasted += insLen;
      if (insLen > max_paste_len) max_paste_len = insLen;
      inBurst = false;
    } else if (e.kind === 'insert' || e.kind === 'replace') {
      chars_typed += insLen;
      if (!inBurst) { bursts++; inBurst = true; }
    }
    if (e.kind === 'replace' && e.removed) {
      revisions++;
      const c = classifyRemoval(e.removed);
      if (c === 'typo') typo_fixes++; else if (c === 'word') word_changes++; else restructures++;
    }
  }
  closeRun();

  const final_chars = prov.length;
  const typed = prov.filter((p) => p === 't').length;
  const first = events[0]?.t ?? 0;
  const last = events[events.length - 1]?.t ?? 0;
  return {
    session_ms: Math.max(0, last - first),
    active_ms,
    chars_typed,
    chars_pasted,
    paste_events,
    max_paste_len,
    corrections: { deletions, typo_fixes, word_changes, restructures },
    revisions,
    bursts,
    pauses_over_2s,
    longest_pause_ms,
    final_chars,
    typed_share: final_chars === 0 ? 0 : Math.round((typed / final_chars) * 1000) / 1000,
    forgiveness: runs === 0 ? 1 : Math.round((absorbed / runs) * 1000) / 1000,
    source: 'content',
  };
}

/**
 * Derive metrics from device-level key classes (no characters). Corrections are runs of
 * back/del keys classified by length; a select followed by typing or deleting is a revision.
 */
export function deriveKeyMetrics(keys: KeyEvent[]): Metrics {
  let chars_typed = 0, chars_pasted = 0, paste_events = 0, max_paste_len = 0;
  let deletions = 0, typo_fixes = 0, word_changes = 0, restructures = 0, revisions = 0;
  let bursts = 0, pauses_over_2s = 0, longest_pause_ms = 0, active_ms = 0;
  let runLen = 0, runs = 0, absorbed = 0, lastDelT = 0, netTyped = 0;
  let selected = false, inBurst = false;
  let prevT: number | null = null;

  const closeRun = (nextT?: number, resumed = false) => {
    if (runLen === 0) return;
    runs++;
    if (resumed && nextT !== undefined && nextT - lastDelT <= RECOVER_MS) absorbed++;
    if (runLen <= 2) typo_fixes++; else if (runLen < 40) word_changes++; else restructures++;
    runLen = 0;
  };

  for (const e of keys) {
    if (prevT !== null) {
      const gap = e.t - prevT;
      if (gap < ACTIVE_GAP_MS) active_ms += gap;
      if (gap > PAUSE_MS) pauses_over_2s++;
      if (gap > longest_pause_ms) longest_pause_ms = gap;
      if (gap >= BURST_GAP_MS) inBurst = false;
    }
    prevT = e.t;
    const typing = e.k === 'char' || e.k === 'upper' || e.k === 'digit' || e.k === 'punct' || e.k === 'space' || e.k === 'enter';

    if (e.k === 'back' || e.k === 'del') {
      deletions++;
      if (selected) { revisions++; selected = false; } else { runLen++; netTyped = Math.max(0, netTyped - 1); }
      lastDelT = e.t;
      inBurst = false;
      continue;
    }
    closeRun(e.t, typing);

    if (e.k === 'select') { selected = true; continue; }
    if (typing) {
      if (selected) { revisions++; selected = false; }
      chars_typed++; netTyped++;
      if (!inBurst) { bursts++; inBurst = true; }
    } else if (e.k === 'paste') {
      paste_events++;
      const n = e.n ?? 0;
      chars_pasted += n;
      if (n > max_paste_len) max_paste_len = n;
      inBurst = false;
    } else {
      selected = false;
    }
  }
  closeRun();

  const final_est = netTyped + chars_pasted;
  const style = styleOfKeys(keys);
  const rhythm = rhythmOfKeys(keys, word_changes + restructures + revisions, deletions, chars_typed);
  const first = keys[0]?.t ?? 0;
  const last = keys[keys.length - 1]?.t ?? 0;
  return {
    session_ms: Math.max(0, last - first),
    active_ms,
    chars_typed,
    chars_pasted,
    paste_events,
    max_paste_len,
    corrections: { deletions, typo_fixes, word_changes, restructures },
    revisions,
    bursts,
    pauses_over_2s,
    longest_pause_ms,
    final_chars: final_est,
    typed_share: final_est === 0 ? 0 : Math.round((netTyped / final_est) * 1000) / 1000,
    forgiveness: runs === 0 ? 1 : Math.round((absorbed / runs) * 1000) / 1000,
    source: 'keys',
    style,
    rhythm,
  };
}

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Timing structure of composition, from key classes only. */
export function rhythmOfKeys(keys: KeyEvent[], revisionEvents: number, deletions = 0, charsTyped = 0): RhythmStats {
  const isLetter = (k: string) => k === 'char' || k === 'upper' || k === 'digit';
  const within: number[] = [];
  const preWord: number[] = [];
  let words = 0, longPauses = 0, boundaryLong = 0;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    const gap = b.t - a.t;
    const boundary = a.k === 'space' || a.k === 'enter' || a.k === 'punct';
    if (isLetter(b.k)) {
      if (isLetter(a.k)) within.push(gap);
      else if (a.k === 'space' || a.k === 'enter') { preWord.push(gap); }
    }
    if (isLetter(b.k) && !isLetter(a.k)) words++;
    if (gap > 2000) { longPauses++; if (boundary) boundaryLong++; }
  }
  if (keys.length && isLetter(keys[0].k)) words++;
  const mw = median(within);
  const mean = within.length ? within.reduce((s, x) => s + x, 0) / within.length : 0;
  const sd = within.length ? Math.sqrt(within.reduce((s, x) => s + (x - mean) ** 2, 0) / within.length) : 0;
  const mp = median(preWord);
  return {
    within_word_median_ms: Math.round(mw),
    pre_word_median_ms: Math.round(mp),
    planning_ratio: mw > 0 ? round3(mp / mw) : 0,
    iki_cv: mean > 0 ? round3(sd / mean) : 0,
    boundary_pause_share: longPauses ? round3(boundaryLong / longPauses) : 0,
    revisions_per_100_words: words ? round3((revisionEvents / words) * 100) : 0,
    words,
    deletions_per_100_chars: charsTyped ? round3((deletions / charsTyped) * 100) : 0,
    long_pauses_per_100_words: words ? round3((longPauses / words) * 100) : 0,
  };
}

/** Style habits from the sequence of typed key classes (deletions and navigation reset adjacency). */
export function styleOfKeys(keys: KeyEvent[]): StyleCounts {
  const s: StyleCounts = { space_before_punct: 0, multi_spaces: 0, punct_runs: 0, longest_punct_run: 0, capitals: 0, caps_runs: 0, punctuation: 0 };
  let prev: string | null = null;
  let spaceRun = 0, punctRun = 0, capsRun = 0;
  const endPunct = () => { if (punctRun >= 2) s.punct_runs++; if (punctRun > s.longest_punct_run) s.longest_punct_run = punctRun; punctRun = 0; };
  const endCaps = () => { if (capsRun >= 3) s.caps_runs++; capsRun = 0; };
  for (const e of keys) {
    const k = e.k;
    if (k === 'punct') {
      s.punctuation++;
      if (prev === 'space') s.space_before_punct++;
      punctRun++;
    } else endPunct();
    if (k === 'space') { spaceRun++; if (spaceRun === 2) s.multi_spaces++; } else spaceRun = 0;
    if (k === 'upper') { s.capitals++; capsRun++; } else if (k !== 'punct') endCaps();
    prev = k === 'char' || k === 'upper' || k === 'digit' || k === 'punct' || k === 'space' || k === 'enter' ? k : null;
  }
  endPunct(); endCaps();
  return s;
}

export function finalText(events: MeritEvent[], initial = ''): string {
  return replay(events, initial).text;
}
