import { canonicalJSON, sha256Hex, type MeritAttestation } from '@merit/spec';
import { verifyRecognition, verifySignature as verifySignatureOf, bodyOf, type Recognition } from '@merit/attest';
import { attestationId } from '@merit/spec';
const attestationIdOf = (c: MeritAttestation) => attestationId(bodyOf(c));
import { readOts } from '../../../packages/verify/src/ots';
import { shapeOf } from './shape';

/**
 * What it takes to enter the Book. The rules are public and the same for everyone; they are checked
 * in the browser for feedback and again on the server, which is authoritative.
 */
export const RULES = {
  min_typed_chars: 250,
  min_typed_share: 0.5,
  recognitions_per_30_days: 3,
  founder_recognitions_per_30_days: 50,
};

/** Founding recognizer: the author of the paper. Their own certificates enter without a recognizer. */
export const FOUNDER = '65a58b8b295932dc13025a227d4736be4c13563abfc4bfc83eb17219c0fba8d3';

/** The digest a certificate's anchor proof must cover: sha256 of the full signed certificate, canonical form. */
export const anchorDigestHex = (c: MeritAttestation) => sha256Hex(canonicalJSON(c));

export function workFloor(c: MeritAttestation): string | null {
  const s = shapeOf(c);
  if (s.typed < RULES.min_typed_chars) return `at least ${RULES.min_typed_chars} typed characters (this has ${s.typed})`;
  if (s.typed / Math.max(1, s.typed + s.pasted) < RULES.min_typed_share) return 'mostly typed, not pasted';
  return null;
}

export function anchorClaim(c: MeritAttestation, ots: Uint8Array): { ok: true; height: number; root: string }[] | string {
  let p;
  try { p = readOts(ots); } catch (e) { return `anchor proof unreadable (${(e as Error).message})`; }
  if (p.file_digest !== anchorDigestHex(c)) return 'anchor proof is for a different certificate';
  const btc = p.attestations.flatMap((a) => (a.kind === 'bitcoin' ? [{ ok: true as const, height: a.height, root: a.merkle_root }] : []));
  if (!btc.length) return p.attestations.some((a) => a.kind === 'pending') ? 'anchor still pending: run "merit upgrade" on the .ots file in a few hours' : 'no Bitcoin attestation in the proof';
  return btc.sort((a, b) => a.height - b.height);
}

export function recognitionClaim(c: MeritAttestation, r: Recognition | undefined, founder = FOUNDER): string | null {
  if (c.author.public_key === founder) return null;
  if (!r) return 'a recognition from someone already in the Book';
  if (!verifyRecognition(r, c.id)) return 'the recognition does not verify for this certificate';
  if (r.recognizer === c.author.public_key) return 'you cannot recognize yourself';
  return null;
}

/**
 * The second door: earned by time. Three of your own certificates, each real work and each anchored
 * in Bitcoin, whose anchors span at least ~7 days of blocks. Time is the one cost a machine can
 * enforce without trusting anyone, and Bitcoin makes it impossible to compress (whitepaper §11).
 */
export const EARN = { certificates: 3, span_blocks: 1008, per_day: 25 };

export interface Proved { certificate: MeritAttestation; ots: Uint8Array }

/** Checks everything about an earned-by-time claim except the block lookups; returns the claims to confirm. */
export function earnedClaim(primary: MeritAttestation, primaryClaims: { height: number; root: string }[], history: Proved[]):
  string | { claims: { height: number; root: string }[][] } {
  const others = history.filter((h) => h.certificate?.id !== primary.id);
  const ids = new Set(others.map((h) => h.certificate?.id));
  if (ids.size !== others.length) return 'the same certificate was given twice';
  if (others.length + 1 < EARN.certificates) return `${EARN.certificates} of your own anchored certificates over 7 days, or a recognition (you gave ${others.length + 1})`;
  const all: { height: number; root: string }[][] = [primaryClaims];
  for (const h of others) {
    const c = h.certificate;
    try { if (c.id !== attestationIdOf(c) || !verifySignatureOf(c)) return 'one of your earlier certificates does not verify'; } catch { return 'one of your earlier certificates is malformed'; }
    if (c.author.public_key !== primary.author.public_key) return 'all certificates must be signed by the same key';
    const f = workFloor(c); if (f) return `each certificate needs ${f}`;
    const a = anchorClaim(c, h.ots); if (typeof a === 'string') return `an earlier certificate: ${a}`;
    all.push(a);
  }
  return { claims: all };
}
