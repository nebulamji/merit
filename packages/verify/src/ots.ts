/**
 * A small, dependency-light OpenTimestamps proof reader that runs anywhere (browser, Worker, Node).
 * It walks the proof's operations from the file digest to each attestation and, for Bitcoin
 * attestations, yields the block height and the Merkle root the proof commits to. Checking that root
 * against the real block header is left to the caller (any block explorer, or your own node).
 */
import { sha256 } from '@noble/hashes/sha256';
import { sha1 } from '@noble/hashes/sha1';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

const MAGIC = new Uint8Array([0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94]);
const BITCOIN = '0588960d73d71901';
const PENDING = '83dfe30d2ef90c8e';

export type OtsAttestation =
  | { kind: 'bitcoin'; height: number; merkle_root: string }   // explorer byte order
  | { kind: 'pending'; uri: string }
  | { kind: 'unknown'; tag: string };

export interface OtsProof { file_digest: string; attestations: OtsAttestation[] }

class Reader {
  i = 0;
  constructor(public b: Uint8Array) {}
  byte() { if (this.i >= this.b.length) throw new Error('truncated proof'); return this.b[this.i++]; }
  bytes(n: number) { if (this.i + n > this.b.length) throw new Error('truncated proof'); const r = this.b.slice(this.i, this.i + n); this.i += n; return r; }
  varuint() { let v = 0, shift = 0, x: number; do { x = this.byte(); v += (x & 0x7f) * 2 ** shift; shift += 7; if (shift > 49) throw new Error('varuint too long'); } while (x & 0x80); return v; }
  varbytes(max = 8192) { const n = this.varuint(); if (n > max) throw new Error('field too long'); return this.bytes(n); }
}

const cat = (a: Uint8Array, b: Uint8Array) => { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; };

function op(tag: number, r: Reader, msg: Uint8Array): Uint8Array {
  switch (tag) {
    case 0xf0: return cat(msg, r.varbytes());          // append
    case 0xf1: return cat(r.varbytes(), msg);          // prepend
    case 0xf2: return msg.slice().reverse();           // reverse
    case 0xf3: return utf8ToBytes(bytesToHex(msg));    // hexlify
    case 0x08: return sha256(msg);
    case 0x02: return sha1(msg);
    case 0x03: return ripemd160(msg);
    case 0x67: return keccak_256(msg);
    default: throw new Error(`unknown op 0x${tag.toString(16)}`);
  }
}

function walk(r: Reader, msg: Uint8Array, out: OtsAttestation[], depth = 0) {
  if (depth > 256) throw new Error('proof too deep');
  const one = (tag: number) => {
    if (tag === 0x00) {
      const t = bytesToHex(r.bytes(8));
      const payload = new Reader(r.varbytes());
      if (t === BITCOIN) out.push({ kind: 'bitcoin', height: payload.varuint(), merkle_root: bytesToHex(msg.slice().reverse()) });
      else if (t === PENDING) out.push({ kind: 'pending', uri: new TextDecoder().decode(payload.varbytes()) });
      else out.push({ kind: 'unknown', tag: t });
    } else walk(r, op(tag, r, msg), out, depth + 1);
  };
  let tag = r.byte();
  while (tag === 0xff) { one(r.byte()); tag = r.byte(); }
  one(tag);
}

export function readOts(bytes: Uint8Array): OtsProof {
  const r = new Reader(bytes);
  const magic = r.bytes(MAGIC.length);
  if (magic.some((x, i) => x !== MAGIC[i])) throw new Error('not an OpenTimestamps proof');
  if (r.varuint() !== 1) throw new Error('unsupported proof version');
  if (r.byte() !== 0x08) throw new Error('only sha256 file digests are supported');
  const digest = r.bytes(32);
  const attestations: OtsAttestation[] = [];
  walk(r, digest, attestations);
  return { file_digest: bytesToHex(digest), attestations };
}

/** Look up a block's Merkle root by height. Default: mempool.space, falling back to blockstream.info. */
export async function blockMerkleRoot(height: number, fetchFn: typeof fetch = fetch): Promise<string> {
  for (const base of ['https://mempool.space/api', 'https://blockstream.info/api']) {
    try {
      const hash = (await (await fetchFn(`${base}/block-height/${height}`)).text()).trim();
      if (!/^[0-9a-f]{64}$/.test(hash)) continue;
      const block = await (await fetchFn(`${base}/block/${hash}`)).json() as { merkle_root?: string };
      if (block.merkle_root) return block.merkle_root;
    } catch { /* try the next explorer */ }
  }
  throw new Error('no block explorer answered');
}

/**
 * Confirm that `digestHex` was committed to Bitcoin: the proof must be for this digest and at least one
 * Bitcoin attestation's Merkle root must equal the real block's. Returns the earliest confirmed height.
 */
export async function confirmBitcoin(digestHex: string, ots: Uint8Array, lookup: (h: number) => Promise<string> = (h) => blockMerkleRoot(h)):
  Promise<{ ok: true; height: number } | { ok: false; reason: string }> {
  let p: OtsProof;
  try { p = readOts(ots); } catch (e) { return { ok: false, reason: (e as Error).message }; }
  if (p.file_digest !== digestHex) return { ok: false, reason: 'proof is for a different file' };
  const btc = p.attestations.filter((a): a is Extract<OtsAttestation, { kind: 'bitcoin' }> => a.kind === 'bitcoin').sort((a, b) => a.height - b.height);
  if (!btc.length) return { ok: false, reason: p.attestations.some((a) => a.kind === 'pending') ? 'anchor still pending; run "merit upgrade" and try again later' : 'no Bitcoin attestation' };
  for (const a of btc) {
    try { if ((await lookup(a.height)) === a.merkle_root) return { ok: true, height: a.height }; } catch { /* next */ }
  }
  return { ok: false, reason: 'Bitcoin attestation does not match the block' };
}
