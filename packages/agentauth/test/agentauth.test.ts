import { describe, expect, it } from 'vitest';
import { signRequest, verifyRequest, jwkThumbprint, directory, meritDelegationHeader, readMeritDelegation } from '@merit/agentauth';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { generateKeyPair, delegate, verifyMutual, agentReceipt } from '@merit/attest';

// RFC 9421 Appendix B.1.4 test key (test-key-ed25519)
const SEED = '9f8362f87a484a954e6e740c5b4c0e84229139a20aa8ab56ff66586f6a7d29c5';
const PUB = bytesToHex(ed25519.getPublicKey(hexToBytes(SEED)));

describe('Web Bot Auth: official draft-05 Ed25519 test vectors', () => {
  it('keyid is the JWK thumbprint', () => {
    expect(jwkThumbprint(PUB)).toBe('poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U');
  });
  it('A.2.1: reproduces the signature byte-for-byte (no Signature-Agent)', () => {
    const h = signRequest({ authority: 'example.com', privateKey: SEED, created: 1735689600, expires: 4889289600,
      nonce: 'g0iqFa9e1ffijlyOScDkXpfSmTbYpRNSGPJrQ1It20ahwgzB3jOUcdgLgFxUg7RMtW4V8IILaKKtA+YuSyIgJQ==' });
    expect(h['Signature']).toBe('sig1=:FFASViSdcgsyaqqYiCnkHreeZzbNKcTzDvZC5uVlP/dn9IbWj8j0o4wKFTH3rBnUiSUBduwm1Gp5VlIPCp01Ag==:');
  });
  it('A.2.2: reproduces the signature byte-for-byte (with Signature-Agent)', () => {
    const h = signRequest({ authority: 'example.com', privateKey: SEED, created: 1735689600, expires: 4889289600, label: 'sig2',
      signatureAgent: 'https://signature-agent.test', agentKey: 'agent2',
      nonce: 'XeP72svPKNiGEg3aDE7WJuTpN69H08oMFqC8NLFy1MptpENAT3WZTYwK+MYdsFMlaqHCJGo9ZAhqer1NWY9Epg==' });
    expect(h['Signature']).toBe('sig2=:DGiW2ErlQh0hc8wY2FQdbnFd6CEmonyY8nlvECIJFaUSYYNvNvSsGyP99BUGtq51gA4ouXlkUwjnta084bpjCg==:');
    expect(h['Signature-Agent']).toBe('agent2="https://signature-agent.test"');
    expect(verifyRequest(h, 'example.com', PUB, 1735689700).ok).toBe(true);
  });
  it('verifies the RFC 9421 quoted form too', () => {
    const h = signRequest({ authority: 'example.com', privateKey: SEED, created: 1, expires: 9e9, signatureAgent: 'https://a.test', agentValueForm: 'rfc9421' });
    expect(verifyRequest(h, 'example.com', PUB, 2).ok).toBe(true);
  });
  it('rejects the wrong host, an expired signature, and a different key', () => {
    const h = signRequest({ authority: 'example.com', privateKey: SEED, created: 100, expires: 200 });
    expect(verifyRequest(h, 'evil.com', PUB, 150).ok).toBe(false);
    expect(verifyRequest(h, 'example.com', PUB, 300).reason).toBe('expired');
    expect(verifyRequest(h, 'example.com', generateKeyPair().publicKey, 150).ok).toBe(false);
  });
  it('directory publishes the key with its thumbprint as kid', () => {
    expect(directory([PUB]).keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519', x: 'JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs', kid: 'poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U' });
  });
});

describe('Merit on top of Web Bot Auth', () => {
  it('a delegated agent signs a request and carries its principal binding', () => {
    const human = generateKeyPair(); const agent = generateKeyPair();
    const d = delegate(human.privateKey, agent.publicKey, 'web:shopping', '2026-12-31T23:59:59Z');
    const now = 1791676800;
    const headers = { ...signRequest({ authority: 'shop.example', privateKey: agent.privateKey, created: now, expires: now + 3600, signatureAgent: 'https://agent.example' }), ...meritDelegationHeader(d) };
    expect(verifyRequest(headers, 'shop.example', agent.publicKey, now + 10).ok).toBe(true);
    const got = readMeritDelegation(headers) as typeof d;
    expect(got.agent).toBe(agent.publicKey);
    const r = agentReceipt(agent.privateKey, got, { work_sha256: 'x', conduct: { directed_by_principal: true, within_terms: true, recoveries: 0 }, created_utc: '2026-11-01T00:00:00Z' });
    expect(verifyMutual(got, r).ok).toBe(true);
  });
});
