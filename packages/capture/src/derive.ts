import type { MeritEvent, Metrics } from '@merit/spec';

const BURST_GAP_MS = 1000;
const ACTIVE_GAP_MS = 5000;
const PAUSE_MS = 2000;

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
  const closeRun = () => {
    if (!runRemoved) return;
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
      inBurst = false;
      continue;
    }
    closeRun();

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
  };
}

export function finalText(events: MeritEvent[], initial = ''): string {
  return replay(events, initial).text;
}
