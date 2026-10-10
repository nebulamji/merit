import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

export const SCHEMA = 'merit-attestation/0.1' as const;

/** One edit event in the private, on-device log (Layer 0). Never leaves the device raw. */
export type EventKind =
  | 'insert'      // typed characters
  | 'delete_back' // backspace
  | 'delete_fwd'  // forward delete
  | 'replace'     // selection overwritten by typing (a revision)
  | 'paste'
  | 'cut'
  | 'undo'
  | 'redo';

export interface MeritEvent {
  seq: number;
  /** ms since session start (monotonic, not wall clock) */
  t: number;
  kind: EventKind;
  /** caret / selection start offset in the document at the time of the edit */
  pos: number;
  /** text removed by this edit, if any */
  removed?: string;
  /** text inserted by this edit, if any */
  inserted?: string;
}

export interface CorrectionCounts {
  /** backspace/delete events */
  deletions: number;
  /** a deletion followed by retyping at the same spot (small fix) */
  typo_fixes: number;
  /** a whole word removed or replaced */
  word_changes: number;
  /** a sentence-or-larger span removed or replaced */
  restructures: number;
}

/** Layer 3: the public summary. Counts and shapes only, no words. */
export interface Metrics {
  session_ms: number;
  active_ms: number;
  chars_typed: number;
  chars_pasted: number;
  paste_events: number;
  max_paste_len: number;
  corrections: CorrectionCounts;
  revisions: number;
  bursts: number;
  pauses_over_2s: number;
  longest_pause_ms: number;
  final_chars: number;
  /** share of the final document's characters that were typed in-session (0..1) */
  typed_share: number;
  /**
   * Forgiveness (0..1): share of correction runs after which composition resumed within 5 s,
   * i.e. the slip was absorbed rather than abandoned. Thesis-010's boundary score.
   */
  forgiveness: number;
  /** what the metrics were derived from */
  source: 'content' | 'keys';
  /**
   * Writing-style signature (no characters): habits that make a person's process recognizable.
   * Imperfection is signal: these are recorded, never "corrected" or penalized.
   */
  style?: StyleCounts;
}

export interface StyleCounts {
  /** a space typed immediately before punctuation, e.g. "word ." */
  space_before_punct: number;
  /** two or more spaces in a row */
  multi_spaces: number;
  /** two or more punctuation marks in a row, e.g. ".." or "...." */
  punct_runs: number;
  /** longest run of consecutive punctuation marks */
  longest_punct_run: number;
  /** capital letters typed */
  capitals: number;
  /** runs of 3+ capitals in a row (emphasis) */
  caps_runs: number;
  /** punctuation marks typed */
  punctuation: number;
}

/**
 * Device-level key event: the class of key and its timing, never the character.
 * Used by the terminal recorder and the menu-bar app.
 */
export type KeyClass =
  | 'char'   // a letter (lowercase)
  | 'upper'  // a capital letter (shift + letter)
  | 'digit'
  | 'punct'  // punctuation or symbol: . , ! ? " ' ; : - ( ) etc. (which one is never stored)
  | 'space' | 'enter' | 'back' | 'del' | 'paste' | 'nav' | 'select' | 'undo' | 'cmd';

export interface KeyEvent {
  seq: number;
  /** ms since session start */
  t: number;
  k: KeyClass;
  /** for paste: number of characters pasted, if known */
  n?: number;
  /** optional app/context label, e.g. "Terminal:claude" */
  app?: string;
}

export interface AttestationBody {
  schema: typeof SCHEMA;
  /** sha256 of the final document text (UTF-8) */
  doc_sha256: string;
  /** Merkle root over salted event leaves (Layer 1 commitment) */
  events_root: string;
  event_count: number;
  metrics: Metrics;
  author: { alg: 'ed25519'; public_key: string };
  /** author's claimed time; the trustworthy time is the anchor */
  created_utc: string;
  /** capture surface, e.g. "merit-editor/0.1" */
  surface: string;
}

export interface MeritAttestation extends AttestationBody {
  id: string;
  signature: string;
}

/**
 * Canonical JSON: keys sorted at every depth, array order kept, undefined dropped,
 * no whitespace. Same rule as the Frontier content-hash identity.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}';
}

export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));
}

/** Content identity: prefix + first 20 hex of sha256(canonical body). */
export function attestationId(body: AttestationBody): string {
  return 'merit_' + sha256Hex(canonicalJSON(body)).slice(0, 20);
}

/** The exact bytes an author signs. */
export function signingPayload(body: AttestationBody): Uint8Array {
  return utf8ToBytes(canonicalJSON(body));
}
