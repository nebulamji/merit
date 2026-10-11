import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes, randomBytes } from '@noble/hashes/utils';
/** Any sequenced event: content edits (MeritEvent) or key classes (KeyEvent). */
export type SeqEvent = { seq: number };

import {
  SCHEMA, canonicalJSON, sha256Hex, attestationId, signingPayload,
  type AttestationBody, type MeritAttestation, type Metrics,
} from '@merit/spec';

/* ---------------- keys: self-custody, generated on the device ---------------- */

export interface KeyPair { privateKey: string; publicKey: string }

export function generateKeyPair(): KeyPair {
  const sk = ed25519.utils.randomPrivateKey();
  return { privateKey: bytesToHex(sk), publicKey: bytesToHex(ed25519.getPublicKey(sk)) };
}

export function publicKeyOf(privateKey: string): string {
  return bytesToHex(ed25519.getPublicKey(hexToBytes(privateKey)));
}

/* ---------------- Merkle commitment over salted event leaves ---------------- */

const LEAF = new Uint8Array([0]);
const NODE = new Uint8Array([1]);

/** Per-event salt derived from a session secret, so the public root reveals nothing about content. */
export function eventSalt(sessionSecret: string, seq: number): string {
  return bytesToHex(sha256(concatBytes(hexToBytes(sessionSecret), utf8ToBytes(':' + seq))));
}

export function leafHash(event: SeqEvent, salt: string): Uint8Array {
  return sha256(concatBytes(LEAF, hexToBytes(salt), utf8ToBytes(canonicalJSON(event))));
}

const node = (l: Uint8Array, r: Uint8Array) => sha256(concatBytes(NODE, l, r));

/** Bottom-up levels; an odd last node is promoted unchanged. */
function levels(leaves: Uint8Array[]): Uint8Array[][] {
  if (leaves.length === 0) return [[sha256(new Uint8Array())]];
  const out = [leaves];
  while (out[out.length - 1].length > 1) {
    const cur = out[out.length - 1];
    const next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? node(cur[i], cur[i + 1]) : cur[i]);
    out.push(next);
  }
  return out;
}

export function merkleRoot(events: SeqEvent[], sessionSecret: string): string {
  const lv = levels(events.map((e) => leafHash(e, eventSalt(sessionSecret, e.seq))));
  return bytesToHex(lv[lv.length - 1][0]);
}

export interface ProofStep { side: 'L' | 'R'; hash: string }

/** Everything needed to show one edit belongs to a certificate, and nothing else. */
export interface Disclosure<E extends SeqEvent = SeqEvent> {
  event: E;
  salt: string;
  index: number;
  proof: ProofStep[];
  events_root: string;
}

export function disclose<E extends SeqEvent>(events: E[], sessionSecret: string, index: number): Disclosure<E> {
  const leaves = events.map((e) => leafHash(e, eventSalt(sessionSecret, e.seq)));
  const lv = levels(leaves);
  const proof: ProofStep[] = [];
  let i = index;
  for (let d = 0; d < lv.length - 1; d++) {
    const cur = lv[d];
    const sib = i % 2 === 0 ? i + 1 : i - 1;
    if (sib < cur.length) proof.push({ side: i % 2 === 0 ? 'R' : 'L', hash: bytesToHex(cur[sib]) });
    i = Math.floor(i / 2);
  }
  return {
    event: events[index],
    salt: eventSalt(sessionSecret, events[index].seq),
    index,
    proof,
    events_root: bytesToHex(lv[lv.length - 1][0]),
  };
}

export function verifyDisclosure<E extends SeqEvent>(d: Disclosure<E>): boolean {
  let h = leafHash(d.event, d.salt);
  for (const s of d.proof) h = s.side === 'R' ? node(h, hexToBytes(s.hash)) : node(hexToBytes(s.hash), h);
  return bytesToHex(h) === d.events_root;
}

/* ---------------- certificate ---------------- */

export function newSessionSecret(): string {
  return bytesToHex(randomBytes(32));
}

export function buildAttestation(args: {
  events: SeqEvent[];
  finalText: string;
  metrics: Metrics;
  sessionSecret: string;
  privateKey: string;
  surface: string;
  createdUtc?: string;
}): MeritAttestation {
  const body = attestationBody({ ...args, publicKey: publicKeyOf(args.privateKey) });
  const signature = bytesToHex(ed25519.sign(signingPayload(body), hexToBytes(args.privateKey)));
  return { ...body, id: attestationId(body), signature };
}

/** The unsigned body of a certificate. Signers that hold the key elsewhere (a keychain, a native side) sign signingPayload(body). */
export function attestationBody(args: { events: SeqEvent[]; finalText: string; metrics: Metrics; sessionSecret: string; publicKey: string; surface: string; createdUtc?: string }): AttestationBody {
  return {
    schema: SCHEMA,
    doc_sha256: sha256Hex(args.finalText),
    events_root: merkleRoot(args.events, args.sessionSecret),
    event_count: args.events.length,
    metrics: args.metrics,
    author: { alg: 'ed25519', public_key: args.publicKey },
    created_utc: args.createdUtc ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    surface: args.surface,
  };
}

/** Bytes a recognizer signs: lets a key held elsewhere produce a recognition. */
export function recognitionBody(recognizerPublicKey: string, certificateId: string, createdUtc = now()) {
  return { schema: 'merit-recognition/0.1' as const, certificate_id: certificateId, recognizer: recognizerPublicKey, created_utc: createdUtc };
}

export function bodyOf(a: MeritAttestation): AttestationBody {
  const { id: _id, signature: _sig, ...body } = a;
  return body;
}

export function verifySignature(a: MeritAttestation): boolean {
  try {
    return ed25519.verify(hexToBytes(a.signature), signingPayload(bodyOf(a)), hexToBytes(a.author.public_key));
  } catch {
    return false;
  }
}

/* ---------------- Know Your Agent: mutual receipts between a person and their agent ---------------- */

/** A person (principal) authorizes an agent key to act for them, within a scope, until a time. */
export interface Delegation {
  schema: 'merit-delegation/0.1';
  principal: string;   // principal public key
  agent: string;       // agent public key
  scope: string;       // e.g. "code:merit-repo", "email:drafts-only"
  not_after_utc: string;
  signature: string;   // by principal
}

/** The agent's signed account of a session it worked in, about the human it worked with. */
export interface AgentReceipt {
  schema: 'merit-agent-receipt/0.1';
  delegation_sig: string;      // binds to the delegation
  about_certificate?: string;  // the human's session certificate id, if any
  work_sha256: string;         // hash of what the agent produced
  conduct: {
    directed_by_principal: boolean; // the principal gave the instructions
    within_terms: boolean;          // the session stayed within the agent's terms of use
    recoveries: number;             // errors raised and recovered from without escalation
  };
  created_utc: string;
  signature: string;           // by agent
}

/** The principal's countersignature on the agent's work: accepted or rejected. */
export interface Countersign {
  schema: 'merit-countersign/0.1';
  receipt_sig: string;
  verdict: 'accepted' | 'rejected';
  created_utc: string;
  signature: string;           // by principal
}

const sigOver = (obj: object, privateKey: string) =>
  bytesToHex(ed25519.sign(utf8ToBytes(canonicalJSON(obj)), hexToBytes(privateKey)));
const sigOk = (obj: object, signature: string, publicKey: string) => {
  try { return ed25519.verify(hexToBytes(signature), utf8ToBytes(canonicalJSON(obj)), hexToBytes(publicKey)); } catch { return false; }
};
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export function delegate(principalKey: string, agentPublicKey: string, scope: string, notAfterUtc: string): Delegation {
  const body = { schema: 'merit-delegation/0.1' as const, principal: publicKeyOf(principalKey), agent: agentPublicKey, scope, not_after_utc: notAfterUtc };
  return { ...body, signature: sigOver(body, principalKey) };
}

export function agentReceipt(agentKey: string, d: Delegation, r: Omit<AgentReceipt, 'schema' | 'delegation_sig' | 'signature' | 'created_utc'> & { created_utc?: string }): AgentReceipt {
  const body = { schema: 'merit-agent-receipt/0.1' as const, delegation_sig: d.signature, ...r, created_utc: r.created_utc ?? now() };
  return { ...body, signature: sigOver(body, agentKey) } as AgentReceipt;
}

export function countersign(principalKey: string, receipt: AgentReceipt, verdict: 'accepted' | 'rejected', createdUtc = now()): Countersign {
  const body = { schema: 'merit-countersign/0.1' as const, receipt_sig: receipt.signature, verdict, created_utc: createdUtc };
  return { ...body, signature: sigOver(body, principalKey) };
}

/** Verify the full triangle: principal → delegation → agent receipt → principal countersign. */
export function verifyMutual(d: Delegation, r: AgentReceipt, c?: Countersign): { ok: boolean; checks: Record<string, boolean> } {
  const { signature: ds, ...dBody } = d;
  const { signature: rs, ...rBody } = r;
  const checks: Record<string, boolean> = {
    delegation_signed_by_principal: sigOk(dBody, ds, d.principal),
    receipt_signed_by_agent: sigOk(rBody, rs, d.agent),
    receipt_bound_to_delegation: r.delegation_sig === d.signature,
    within_delegation_window: r.created_utc <= d.not_after_utc,
  };
  if (c) {
    const { signature: cs, ...cBody } = c;
    checks.countersigned_by_principal = sigOk(cBody, cs, d.principal);
    checks.countersign_bound_to_receipt = c.receipt_sig === r.signature;
  }
  return { ok: Object.values(checks).every(Boolean), checks };
}

/**
 * Recognition: one person signs that they recognize another person's certificate.
 * It is the step from claim to evidence (whitepaper §5). A recognition names the certificate by id,
 * so it cannot be moved to a different certificate.
 */
export interface Recognition {
  schema: 'merit-recognition/0.1';
  certificate_id: string;
  recognizer: string;      // recognizer's public key
  created_utc: string;
  signature: string;
}

export function recognize(recognizerKey: string, certificateId: string, createdUtc = now()): Recognition {
  const body = { schema: 'merit-recognition/0.1' as const, certificate_id: certificateId, recognizer: publicKeyOf(recognizerKey), created_utc: createdUtc };
  return { ...body, signature: sigOver(body, recognizerKey) };
}

export function verifyRecognition(r: Recognition, certificateId: string): boolean {
  try {
    const { signature, ...body } = r;
    return r.schema === 'merit-recognition/0.1' && r.certificate_id === certificateId && sigOk(body, signature, r.recognizer);
  } catch { return false; }
}
