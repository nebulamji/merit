// @ts-ignore: opentimestamps ships no types
import OT from 'opentimestamps';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { canonicalJSON, sha256Hex, attestationId, type MeritAttestation } from '@merit/spec';
import { verifySignature, bodyOf, verifyDisclosure, type Disclosure } from '@merit/attest';

/** The OTS library logs progress to stdout; keep our output clean (CLI prints JSON). */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
}

/** The digest that gets anchored: sha256 of the full signed certificate, canonical form. */
export function anchorDigest(cert: MeritAttestation): Uint8Array {
  return sha256(utf8ToBytes(canonicalJSON(cert)));
}

/** Submit the certificate's digest to the public OpenTimestamps calendars. Returns .ots bytes (pending). */
export async function stamp(cert: MeritAttestation): Promise<Uint8Array> {
  const d = OT.DetachedTimestampFile.fromHash(new OT.Ops.OpSHA256(), Array.from(anchorDigest(cert)));
  await quiet(() => OT.stamp(d));
  return Uint8Array.from(d.serializeToBytes());
}

/** Ask the calendars whether the pending stamp has been committed to a Bitcoin block yet. */
export async function upgrade(ots: Uint8Array): Promise<{ ots: Uint8Array; changed: boolean }> {
  const d = OT.DetachedTimestampFile.deserialize(Array.from(ots));
  const changed: boolean = await quiet(() => OT.upgrade(d));
  return { ots: Uint8Array.from(d.serializeToBytes()), changed };
}

export type AnchorStatus =
  | { status: 'none' }
  | { status: 'pending' }
  | { status: 'bitcoin'; height: number; time_utc: string }
  | { status: 'mismatch' }
  | { status: 'error'; message: string };

export async function checkAnchor(cert: MeritAttestation, ots: Uint8Array, timeoutMs = 15000): Promise<AnchorStatus> {
  try {
    const dots = OT.DetachedTimestampFile.deserialize(Array.from(ots));
    if (bytesToHex(Uint8Array.from(dots.fileDigest())) !== bytesToHex(anchorDigest(cert))) return { status: 'mismatch' };
    const det = OT.DetachedTimestampFile.fromHash(new OT.Ops.OpSHA256(), Array.from(anchorDigest(cert)));
    const r: any = await quiet<any>(() => OT.verify(dots, det, { ignoreBitcoinNode: true, timeout: timeoutMs }));
    if (r && r.bitcoin) return { status: 'bitcoin', height: r.bitcoin.height, time_utc: new Date(r.bitcoin.timestamp * 1000).toISOString() };
    return { status: 'pending' };
  } catch (e) {
    return { status: 'error', message: (e as Error).message };
  }
}

export interface Report {
  id: string;
  ok: boolean;
  checks: {
    schema: boolean;
    id_matches_content: boolean;
    signature: boolean;
    document_matches?: boolean;
    disclosures?: { index: number; ok: boolean }[];
  };
  anchor: AnchorStatus;
  summary: string;
}

/**
 * Verify a certificate offline (signature, content id, optional document text, optional disclosed edits)
 * and, if an .ots proof is given, check its Bitcoin anchor via public block explorers.
 */
export async function verifyCertificate(args: {
  cert: MeritAttestation;
  ots?: Uint8Array;
  text?: string;
  disclosures?: Disclosure[];
  network?: boolean;
}): Promise<Report> {
  const { cert } = args;
  const checks: Report['checks'] = {
    schema: cert.schema === 'merit-attestation/0.1',
    id_matches_content: cert.id === attestationId(bodyOf(cert)),
    signature: verifySignature(cert),
  };
  if (args.text !== undefined) checks.document_matches = sha256Hex(args.text) === cert.doc_sha256;
  if (args.disclosures) {
    checks.disclosures = args.disclosures.map((d) => ({ index: d.index, ok: d.events_root === cert.events_root && verifyDisclosure(d) }));
  }
  let anchor: AnchorStatus = { status: 'none' };
  if (args.ots) anchor = args.network === false ? { status: 'pending' } : await checkAnchor(cert, args.ots);

  const core = checks.schema && checks.id_matches_content && checks.signature
    && checks.document_matches !== false
    && (checks.disclosures ?? []).every((d) => d.ok)
    && anchor.status !== 'mismatch';

  const m = cert.metrics;
  const anchorLine = anchor.status === 'bitcoin'
    ? `anchored in Bitcoin block ${anchor.height} (${anchor.time_utc})`
    : anchor.status === 'pending' ? 'anchor pending (submitted, not yet in a block)'
    : anchor.status === 'none' ? 'no anchor supplied' : `anchor ${anchor.status}`;
  const summary = core
    ? `VALID. Signed by ${cert.author.public_key.slice(0, 12)}…; ${m.final_chars} characters, ${Math.round(m.typed_share * 100)}% typed in session, ` +
      `${m.corrections.deletions} deletions, ${m.revisions} revisions, ${m.paste_events} pastes, ${Math.round(m.active_ms / 60000)} active minutes; ${anchorLine}.`
    : 'INVALID. See checks.';
  return { id: cert.id, ok: core, checks, anchor, summary };
}
