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
