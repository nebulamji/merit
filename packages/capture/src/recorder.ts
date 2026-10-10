import type { EventKind, MeritEvent } from '@merit/spec';

/**
 * Browser recorder for a <textarea>. Listens to `beforeinput` (which reports intent before the DOM
 * changes) and records each edit with what it removed and inserted, on the device only.
 * It never sends anything anywhere: there is no network code in this package (predicate P6).
 */
export interface Recorder {
  events(): MeritEvent[];
  stop(): void;
}

const KIND: Record<string, EventKind | undefined> = {
  insertText: 'insert',
  insertLineBreak: 'insert',
  insertParagraph: 'insert',
  insertReplacementText: 'replace', // e.g. spellcheck suggestion accepted
  insertFromPaste: 'paste',
  insertFromDrop: 'paste',
  deleteContentBackward: 'delete_back',
  deleteWordBackward: 'delete_back',
  deleteSoftLineBackward: 'delete_back',
  deleteHardLineBackward: 'delete_back',
  deleteContentForward: 'delete_fwd',
  deleteWordForward: 'delete_fwd',
  deleteByCut: 'cut',
  historyUndo: 'undo',
  historyRedo: 'redo',
};

export function recordTextarea(el: HTMLTextAreaElement, now: () => number = () => performance.now()): Recorder {
  const log: MeritEvent[] = [];
  const t0 = now();
  let seq = 0;

  const onBeforeInput = (ev: Event) => {
    const e = ev as InputEvent;
    let kind = KIND[e.inputType];
    if (!kind) return;
    const value = el.value;
    let start = el.selectionStart ?? 0;
    let end = el.selectionEnd ?? start;

    // Collapsed-caret deletes remove one unit next to the caret; word/line deletes are approximated
    // from the target range when the browser provides it.
    const ranges = e.getTargetRanges?.() ?? [];
    if (start === end && ranges.length === 0) {
      if (kind === 'delete_back' && start > 0) start = start - 1;
      else if (kind === 'delete_fwd' && end < value.length) end = end + 1;
    }

    if (kind === 'undo' || kind === 'redo') {
      // Undo/redo content is resolved after the DOM changes; record the resulting diff.
      const before = value;
      queueMicrotask(() => {
        const after = el.value;
        const d = diff(before, after);
        log.push({ seq: seq++, t: Math.round(now() - t0), kind: kind!, pos: d.pos, removed: d.removed || undefined, inserted: d.inserted || undefined });
      });
      return;
    }

    let inserted = e.data ?? undefined;
    if ((kind === 'paste') && !inserted) inserted = e.dataTransfer?.getData('text/plain') ?? undefined;
    if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') inserted = '\n';
    const removed = value.slice(start, end) || undefined;
    if (kind === 'insert' && removed) kind = 'replace'; // typing over a selection = a revision

    log.push({ seq: seq++, t: Math.round(now() - t0), kind, pos: start, removed, inserted });
  };

  el.addEventListener('beforeinput', onBeforeInput);
  return {
    events: () => log.slice(),
    stop: () => el.removeEventListener('beforeinput', onBeforeInput),
  };
}

/** Minimal single-span diff (common prefix/suffix), used for undo/redo. */
export function diff(before: string, after: string): { pos: number; removed: string; inserted: string } {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  return { pos: p, removed: before.slice(p, before.length - s), inserted: after.slice(p, after.length - s) };
}
