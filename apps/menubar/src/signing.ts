// The Sign button's logic, with no window or native calls in it, so it can be tested the same way every time.
//   parseSession: a recorded session file -> key events, or a plain reason it cannot be signed.
//   signKeys:     key events -> a signed certificate (signing is handed in: in the app it is the native, keychain-held key).
import { attestationId, signingPayload, type KeyEvent, type MeritAttestation } from '@merit/spec';
import { attestationBody, newSessionSecret, verifySignature } from '@merit/attest';
import { deriveKeyMetrics, privacyLint } from '@merit/capture';

export type Parsed =
  | { status: 'ready'; keys: KeyEvent[]; ignoredTail: boolean }
  | { status: 'empty' }
  | { status: 'corrupt'; reason: string }
  | { status: 'refused'; reason: string };

const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/**
 * Tolerant of the one damage a crash can cause (a half-written LAST line), strict about everything else:
 * a bad line in the middle means the file cannot be trusted. Null fields are treated as absent.
 */
export function parseSession(raw: string): Parsed {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { status: 'empty' };
  const keys: KeyEvent[] = []; let ignoredTail = false;
  for (let i = 0; i < lines.length; i++) {
    let e: any;
    try { e = JSON.parse(lines[i]); } catch {
      if (i === lines.length - 1 && i > 0) { ignoredTail = true; break; }       // a half-written last line
      return { status: 'corrupt', reason: `line ${i + 1} is not readable` };
    }
    if (e && typeof e === 'object') for (const f of Object.keys(e)) if (e[f] === null) delete e[f];
    keys.push(e);
  }
  const problems = privacyLint(keys);
  if (problems.length) return { status: 'refused', reason: `the session contains more than key types (${problems[0]})` };
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i] as any;
    if (!num(k.seq) || !num(k.t)) return { status: 'corrupt', reason: `event ${i + 1} has no valid sequence or time` };
    if (i > 0 && k.t < (keys[i - 1] as any).t) return { status: 'corrupt', reason: `event ${i + 1} goes back in time` };
  }
  if (!keys.length) return { status: 'empty' };
  return { status: 'ready', keys, ignoredTail };
}

export type Signed = { ok: true; cert: MeritAttestation; secret: string } | { ok: false; error: string };

export async function signKeys(keys: KeyEvent[], publicKey: string, sign: (payload: Uint8Array) => Promise<string>, opts: { secret?: string; surface?: string; createdUtc?: string; eventsRoot?: string } = {}): Promise<Signed> {
  try {
    const secret = opts.secret ?? newSessionSecret();
    const body = attestationBody({ events: keys, finalText: '', metrics: deriveKeyMetrics(keys), sessionSecret: secret, publicKey, surface: opts.surface ?? 'merit-desktop/0.1', createdUtc: opts.createdUtc, eventsRoot: opts.eventsRoot });
    const signature = await sign(signingPayload(body));
    const cert: MeritAttestation = { ...body, id: attestationId(body), signature };
    if (!verifySignature(cert)) return { ok: false, error: 'the signature did not check out, so nothing was written' };
    return { ok: true, cert, secret };
  } catch (e) { return { ok: false, error: (e as Error).message ?? String(e) }; }
}
