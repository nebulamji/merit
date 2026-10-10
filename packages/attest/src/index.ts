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
  const body: AttestationBody = {
    schema: SCHEMA,
    doc_sha256: sha256Hex(args.finalText),
    events_root: merkleRoot(args.events, args.sessionSecret),
    event_count: args.events.length,
    metrics: args.metrics,
    author: { alg: 'ed25519', public_key: publicKeyOf(args.privateKey) },
    created_utc: args.createdUtc ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    surface: args.surface,
  };
  const signature = bytesToHex(ed25519.sign(signingPayload(body), hexToBytes(args.privateKey)));
  return { ...body, id: attestationId(body), signature };
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
