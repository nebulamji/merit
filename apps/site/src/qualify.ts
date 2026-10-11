import { canonicalJSON, sha256Hex, type MeritAttestation } from '@merit/spec';
import { verifyRecognition, type Recognition } from '@merit/attest';
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
