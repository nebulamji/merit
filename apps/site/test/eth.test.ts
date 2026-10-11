import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { addressOf, ethSign, merkle, leafOf, portfolioDigest, markDigest } from '../src/eth';
import { bytesToHex } from '@noble/hashes/utils';

describe('eth plumbing', () => {
  it('derives the well-known address for private key 1', () => {
    expect(addressOf('0x' + '00'.repeat(31) + '01')).toBe('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
  });
  it('writes a cross-check fixture for the Solidity tests', () => {
    const key = '0x' + 'b00c'.padStart(64, '0');
    const accounts: [string, number][] = [['0x00000000000000000000000000000000000000a1', 2], ['0x0000000000000000000000000000000000000b0b', 1], ['0x0000000000000000000000000000000000000c0c', 4]];
    const leaves = accounts.map(([a, s]) => leafOf(a, s));
    const t = merkle(leaves);
    const contract = '0x00000000000000000000000000000000000000f0';
    const d = portfolioDigest(8453, contract, 9, 10n ** 16n, 100, 200, t.root, 7, '0x' + 'ab'.repeat(32));
    const m = markDigest(8453, contract, 5, accounts[0][0]);
    writeFileSync(new URL('../../../contracts/test/fixture.json', import.meta.url), JSON.stringify({
      signer: addressOf(key), root: t.root, proofs: accounts.map((_, i) => t.proof(i)), accounts: accounts.map(([a]) => a), shares: accounts.map(([, s]) => s),
      portfolioDigest: '0x' + bytesToHex(d), portfolioSig: ethSign(d, key), markDigest: '0x' + bytesToHex(m), markSig: ethSign(m, key),
    }, null, 2));
    expect(t.root).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
