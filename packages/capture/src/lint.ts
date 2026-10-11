/** Device sessions may contain only key types and timing. Shared by the CLI and the desktop app. */
const KEY_CLASSES = new Set(['char', 'upper', 'digit', 'punct', 'space', 'enter', 'back', 'del', 'paste', 'nav', 'select', 'undo', 'cmd', 'review']);
const KEY_FIELDS = new Set(['seq', 't', 'k', 'n', 'app', 'decision', 'kind']);
const REVIEW_DECISIONS = new Set(['accept', 'keep']);
const REVIEW_KINDS = new Set(['space_before_punct', 'repeated_punct', 'multi_space', 'unbalanced_quote', 'doubled_quote']);

export function privacyLint(keys: unknown[]): string[] {
  const out: string[] = [];
  keys.forEach((e, i) => {
    if (!e || typeof e !== 'object') { out.push(`event ${i}: not an object`); return; }
    for (const f of Object.keys(e)) if (!KEY_FIELDS.has(f)) out.push(`event ${i}: unexpected field "${f}"`);
    const ev = e as Record<string, unknown>;
    if (!KEY_CLASSES.has(String(ev.k))) out.push(`event ${i}: unknown key type "${String(ev.k).slice(0, 12)}"`);
    if (ev.n !== undefined && typeof ev.n !== 'number') out.push(`event ${i}: paste length must be a number`);
    if (ev.app !== undefined && (typeof ev.app !== 'string' || ev.app.length > 64)) out.push(`event ${i}: bad app label`);
    if (ev.k === 'review') {
      if (!REVIEW_DECISIONS.has(String(ev.decision))) out.push(`event ${i}: review decision must be accept|keep`);
      if (!REVIEW_KINDS.has(String(ev.kind))) out.push(`event ${i}: unknown correction kind`);
    } else if (ev.decision !== undefined || ev.kind !== undefined) out.push(`event ${i}: decision/kind only allowed on review events`);
  });
  return out;
}
