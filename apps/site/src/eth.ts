// Minimal Ethereum plumbing for the Book: the Book's secp256k1 signatures (EIP-191 over a 32-byte
// digest, as OpenZeppelin's MessageHashUtils.toEthSignedMessageHash expects), ABI-encoded static
// words, and an OpenZeppelin-compatible Merkle tree (double-hashed leaves, sorted pairs).
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes, concatBytes, utf8ToBytes } from '@noble/hashes/utils';

export const keccak = (b: Uint8Array) => keccak_256(b);
const strip = (h: string) => h.replace(/^0x/, '').toLowerCase();

/** One 32-byte ABI word for uint/address/bytes32 values. */
export function word(v: bigint | number | string): Uint8Array {
  if (typeof v === 'string') return hexToBytes(strip(v).padStart(64, '0'));
  let x = BigInt(v); const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}
export const abiEncode = (...vals: (bigint | number | string)[]) => concatBytes(...vals.map(word));

export function addressOf(privateKeyHex: string): string {
  const pub = secp256k1.getPublicKey(hexToBytes(strip(privateKeyHex)), false).slice(1);
  return '0x' + bytesToHex(keccak(pub).slice(-20));
}

/** Sign a 32-byte digest the way ECDSA.recover(toEthSignedMessageHash(digest)) verifies it. */
export function ethSign(digest: Uint8Array, privateKeyHex: string): string {
  const h = keccak(concatBytes(utf8ToBytes('\x19Ethereum Signed Message:\n32'), digest));
  const sig = secp256k1.sign(h, hexToBytes(strip(privateKeyHex)));
  return '0x' + bytesToHex(sig.toCompactRawBytes()) + (27 + sig.recovery).toString(16).padStart(2, '0');
}

export const portfolioDigest = (chainId: number, contract: string, id: number, price: bigint, start: number, end: number, root: string, totalShares: number, bookState: string) =>
  keccak(abiEncode(chainId, contract, id, price, start, end, root, totalShares, bookState));
export const markDigest = (chainId: number, contract: string, seq: number, to: string) => keccak(abiEncode(chainId, contract, seq, to));

// ---- Merkle tree (OpenZeppelin MerkleProof-compatible) ----
export const leafOf = (account: string, shares: number) => keccak(keccak(abiEncode(account, shares)));
const cmp = (a: Uint8Array, b: Uint8Array) => { for (let i = 0; i < 32; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const pair = (a: Uint8Array, b: Uint8Array) => (cmp(a, b) <= 0 ? keccak(concatBytes(a, b)) : keccak(concatBytes(b, a)));

export function merkle(leaves: Uint8Array[]): { root: string; proof: (i: number) => string[] } {
  if (!leaves.length) return { root: '0x' + '00'.repeat(32), proof: () => [] };
  const layers: Uint8Array[][] = [leaves.slice().sort(cmp)];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1], next: Uint8Array[] = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? pair(prev[i], prev[i + 1]) : prev[i]);
    layers.push(next);
  }
  const sorted = layers[0];
  return {
    root: '0x' + bytesToHex(layers[layers.length - 1][0]),
    proof: (i: number) => {
      let idx = sorted.findIndex((l) => cmp(l, leaves[i]) === 0); const out: string[] = [];
      for (let k = 0; k < layers.length - 1; k++) {
        const sib = idx ^ 1;
        if (sib < layers[k].length) out.push('0x' + bytesToHex(layers[k][sib]));
        idx >>= 1;
      }
      return out;
    },
  };
}

export const dayDigest = (chainId: number, contract: string, id: number, root: string, totalShares: number, bookState: string) =>
  keccak(abiEncode(chainId, contract, id, root, totalShares, bookState));

/** Read the current daily auction straight from the chain: (id, amount, start, end, bidder, settled). */
export async function readAuction(rpc: string, contract: string): Promise<{ id: number; end: number; settled: boolean; amount: bigint; bidder: string; chainTime: number }> {
  const selector = '0x' + bytesToHex(keccak(utf8ToBytes('auction()')).slice(0, 4));
  const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data: selector }, 'latest'] }) });
  const j: any = await r.json();
  const h = strip(j.result ?? ''); if (h.length < 64 * 6) throw new Error('auction unreadable');
  const w = (i: number) => BigInt('0x' + h.slice(i * 64, i * 64 + 64));
  const b: any = await (await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_getBlockByNumber', params: ['latest', false] }) })).json();
  const chainTime = Number(BigInt(b.result.timestamp));
  return { chainTime, id: Number(w(0)), amount: w(1), end: Number(w(3)), bidder: '0x' + h.slice(4 * 64 + 24, 5 * 64), settled: w(5) === 1n };
}
