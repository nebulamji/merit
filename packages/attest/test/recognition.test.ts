import { describe, expect, it } from 'vitest';
import { generateKeyPair, recognize, verifyRecognition } from '@merit/attest';

describe('recognition', () => {
  it('verifies for the named certificate only, and only unaltered', () => {
    const k = generateKeyPair();
    const r = recognize(k.privateKey, 'merit_abc');
    expect(verifyRecognition(r, 'merit_abc')).toBe(true);
    expect(verifyRecognition(r, 'merit_other')).toBe(false);
    expect(verifyRecognition({ ...r, recognizer: generateKeyPair().publicKey }, 'merit_abc')).toBe(false);
  });
});

import { attestationBody, buildAttestation, recognitionBody, newSessionSecret } from '@merit/attest';
import { attestationId, signingPayload, canonicalJSON } from '@merit/spec';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

describe('external signers (desktop native side) produce identical artifacts', () => {
  it('certificate: body + external signature equals buildAttestation', () => {
    const k = generateKeyPair(); const secret = newSessionSecret();
    const args = { events: [{ seq: 0, t: 1, k: 'char' }] as any, finalText: '', metrics: { chars_typed: 1 } as any, sessionSecret: secret, surface: 's', createdUtc: '2026-10-11T00:00:00Z' };
    const ref = buildAttestation({ ...args, privateKey: k.privateKey });
    const body = attestationBody({ ...args, publicKey: k.publicKey });
    const sig = bytesToHex(ed25519.sign(signingPayload(body), hexToBytes(k.privateKey)));
    expect({ ...body, id: attestationId(body), signature: sig }).toEqual(ref);
  });
  it('recognition: body + external signature verifies', () => {
    const k = generateKeyPair();
    const body = recognitionBody(k.publicKey, 'merit_x');
    const rec = { ...body, signature: bytesToHex(ed25519.sign(utf8ToBytes(canonicalJSON(body)), hexToBytes(k.privateKey))) };
    expect(verifyRecognition(rec, 'merit_x')).toBe(true);
  });
});
