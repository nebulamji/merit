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

// ---------------------------------------------------------------------------------------------
// Full proof trees: build, merge, serialize, stamp and upgrade. Network access is injected so the
// same code runs in Node, a browser, or a desktop app that routes HTTP through its native side.

type OtsOp = { tag: number; arg?: Uint8Array };
export interface OtsTree { msg: Uint8Array; attestations: { tag: Uint8Array; payload: Uint8Array }[]; ops: { op: OtsOp; next: OtsTree }[] }

const BINARY = new Set([0xf0, 0xf1]);
function applyOp(o: OtsOp, msg: Uint8Array): Uint8Array {
  const r = new Reader(new Uint8Array(0));
  if (BINARY.has(o.tag)) return o.tag === 0xf0 ? cat(msg, o.arg!) : cat(o.arg!, msg);
  return op(o.tag, r, msg);
}

function parseTree(r: Reader, msg: Uint8Array, depth = 0): OtsTree {
  if (depth > 256) throw new Error('proof too deep');
  const node: OtsTree = { msg, attestations: [], ops: [] };
  const one = (tag: number) => {
    if (tag === 0x00) { node.attestations.push({ tag: r.bytes(8), payload: r.varbytes() }); return; }
    const o: OtsOp = { tag, arg: BINARY.has(tag) ? r.varbytes() : undefined };
    node.ops.push({ op: o, next: parseTree(r, applyOp(o, msg), depth + 1) });
  };
  let tag = r.byte();
  while (tag === 0xff) { one(r.byte()); tag = r.byte(); }
  one(tag);
  return node;
}

class Writer {
  parts: number[] = [];
  byte(b: number) { this.parts.push(b); }
  bytes(b: Uint8Array) { for (const x of b) this.parts.push(x); }
  varuint(n: number) { do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 0x80; this.parts.push(b); } while (n > 0); }
  varbytes(b: Uint8Array) { this.varuint(b.length); this.bytes(b); }
  out() { return Uint8Array.from(this.parts); }
}

function writeTree(w: Writer, t: OtsTree) {
  const items: (() => void)[] = [
    ...t.attestations.map((a) => () => { w.byte(0x00); w.bytes(a.tag); w.varbytes(a.payload); }),
    ...t.ops.map(({ op: o, next }) => () => { w.byte(o.tag); if (o.arg) w.varbytes(o.arg); writeTree(w, next); }),
  ];
  if (!items.length) throw new Error('empty proof node');
  items.forEach((write, i) => { if (i < items.length - 1) w.byte(0xff); write(); });
}

export function readOtsTree(bytes: Uint8Array): { digest: Uint8Array; tree: OtsTree } {
  const r = new Reader(bytes);
  const magic = r.bytes(MAGIC.length);
  if (magic.some((x, i) => x !== MAGIC[i])) throw new Error('not an OpenTimestamps proof');
  if (r.varuint() !== 1) throw new Error('unsupported proof version');
  if (r.byte() !== 0x08) throw new Error('only sha256 file digests are supported');
  const digest = r.bytes(32);
  return { digest, tree: parseTree(r, digest) };
}

export function writeOtsTree(digest: Uint8Array, tree: OtsTree): Uint8Array {
  const w = new Writer();
  w.bytes(MAGIC); w.varuint(1); w.byte(0x08); w.bytes(digest); writeTree(w, tree);
  return w.out();
}

function merge(into: OtsTree, from: OtsTree) {
  for (const a of from.attestations) if (!into.attestations.some((b) => bytesToHex(b.tag) === bytesToHex(a.tag) && bytesToHex(b.payload) === bytesToHex(a.payload))) into.attestations.push(a);
  for (const o of from.ops) {
    const same = into.ops.find((p) => p.op.tag === o.op.tag && bytesToHex(p.op.arg ?? new Uint8Array()) === bytesToHex(o.op.arg ?? new Uint8Array()));
    if (same) merge(same.next, o.next); else into.ops.push(o);
  }
}

export const CALENDARS = ['https://a.pool.opentimestamps.org', 'https://b.pool.opentimestamps.org', 'https://a.pool.eternitywall.com', 'https://ots.btc.catallaxy.com'];
export type Post = (url: string, body: Uint8Array) => Promise<Uint8Array | null>;
export type Get = (url: string) => Promise<Uint8Array | null>;

/** Submit a 32-byte digest to the public calendars. A random nonce keeps the digest itself private. */
export async function stampDigest(digest: Uint8Array, post: Post, nonce: Uint8Array, calendars = CALENDARS): Promise<Uint8Array> {
  const withNonce = cat(digest, nonce);
  const commitment = sha256(withNonce);
  const top: OtsTree = { msg: commitment, attestations: [], ops: [] };
  const answers = await Promise.all(calendars.map(async (c) => { try { return await post(`${c}/digest`, commitment); } catch { return null; } }));
  let got = 0;
  for (const a of answers) {
    if (!a) continue;
    try { merge(top, parseTree(new Reader(a), commitment)); got++; } catch { /* bad answer */ }
  }
  if (!got) throw new Error('no timestamp calendar answered');
  const root: OtsTree = { msg: digest, attestations: [], ops: [{ op: { tag: 0xf0, arg: nonce }, next: { msg: withNonce, attestations: [], ops: [{ op: { tag: 0x08 }, next: top }] } }] };
  return writeOtsTree(digest, root);
}

/** Ask each calendar a pending attestation names for the finished path. Returns the new proof and whether it changed. */
export async function upgradeOts(bytes: Uint8Array, get: Get): Promise<{ ots: Uint8Array; changed: boolean }> {
  const { digest, tree } = readOtsTree(bytes);
  let changed = false;
  const visit = async (t: OtsTree) => {
    for (const a of [...t.attestations]) {
      if (bytesToHex(a.tag) !== PENDING) continue;
      const uri = new TextDecoder().decode(new Reader(a.payload).varbytes());
      if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(uri)) continue;
      try {
        const body = await get(`${uri}/timestamp/${bytesToHex(t.msg)}`);
        if (!body) continue;
        const up = parseTree(new Reader(body), t.msg);
        const before = bytesToHex(writeOtsTree(digest, tree));
        merge(t, up);
        if (bytesToHex(writeOtsTree(digest, tree)) !== before) changed = true;
      } catch { /* not ready */ }
    }
    for (const o of t.ops) await visit(o.next);
  };
  await visit(tree);
  return { ots: writeOtsTree(digest, tree), changed };
}
