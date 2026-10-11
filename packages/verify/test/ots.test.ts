import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { readOts, confirmBitcoin } from '../src/ots';

const proof = new Uint8Array(readFileSync('anchors/v0.1.0.sha256.ots'));
const digest = bytesToHex(sha256(readFileSync('anchors/v0.1.0.sha256')));

describe('OpenTimestamps reader', () => {
  it('reads the file digest and finds a Bitcoin attestation', () => {
    const p = readOts(proof);
    expect(p.file_digest).toBe(digest);
    expect(p.attestations.some((a) => a.kind === 'bitcoin')).toBe(true);
  });
  it('rejects a proof for a different digest and a corrupted proof', async () => {
    expect((await confirmBitcoin('00'.repeat(32), proof, async () => '')).ok).toBe(false);
    const bad = proof.slice(); bad[5] ^= 1;
    expect(() => readOts(bad)).toThrow();
  });
  it('confirms only when the block root matches', async () => {
    const btc = readOts(proof).attestations.find((a) => a.kind === 'bitcoin') as any;
    expect(await confirmBitcoin(digest, proof, async () => btc.merkle_root)).toMatchObject({ ok: true, height: btc.height });
    expect((await confirmBitcoin(digest, proof, async () => 'ff'.repeat(32))).ok).toBe(false);
  });
  it.skipIf(!process.env.MERIT_NET)('matches the real Bitcoin block (network)', async () => {
    expect((await confirmBitcoin(digest, proof)).ok).toBe(true);
  });
});
