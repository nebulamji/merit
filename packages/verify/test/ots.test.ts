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

import { readOtsTree, writeOtsTree, stampDigest, upgradeOts } from '../src/ots';
describe('OpenTimestamps trees', () => {
  it('round-trips a real Bitcoin-attested proof byte for byte', () => {
    const { digest, tree } = readOtsTree(proof);
    expect(Buffer.from(writeOtsTree(digest, tree)).equals(Buffer.from(proof))).toBe(true);
  });
  it.skipIf(!process.env.MERIT_NET)('stamps with the live calendars, readable by the reference library (network)', async () => {
    const post = async (url: string, body: Uint8Array) => { const r = await fetch(url, { method: 'POST', body: body as BodyInit, headers: { Accept: 'application/vnd.opentimestamps.v1' } }); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; };
    const digest = sha256(new TextEncoder().encode('merit ots test ' + Date.now()));
    const ots = await stampDigest(digest, post, crypto.getRandomValues(new Uint8Array(16)));
    const p = readOts(ots);
    expect(p.file_digest).toBe(bytesToHex(digest));
    expect(p.attestations.filter((a) => a.kind === 'pending').length).toBeGreaterThanOrEqual(2);
    // @ts-ignore no types
    const OT = (await import('opentimestamps')).default;
    const d = OT.DetachedTimestampFile.deserialize(Array.from(ots));
    expect(Buffer.from(d.fileDigest()).toString('hex')).toBe(bytesToHex(digest));
    const get = async (url: string) => { const r = await fetch(url, { headers: { Accept: 'application/vnd.opentimestamps.v1' } }); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; };
    const up = await upgradeOts(ots, get);
    expect(readOts(up.ots).file_digest).toBe(bytesToHex(digest));
  }, 60000);
});
