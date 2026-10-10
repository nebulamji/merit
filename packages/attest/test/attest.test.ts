import { describe, expect, it } from 'vitest';
import type { MeritEvent } from '@merit/spec';
import { attestationId } from '@merit/spec';
import { deriveMetrics, finalText } from '@merit/capture';
import {
  generateKeyPair, newSessionSecret, buildAttestation, verifySignature, bodyOf,
  merkleRoot, disclose, verifyDisclosure,
} from '@merit/attest';

function sample(n = 7): MeritEvent[] {
  const ev: MeritEvent[] = [];
  const word = 'cymbals';
  for (let i = 0; i < n; i++) ev.push({ seq: i, t: i * 110, kind: 'insert', pos: i, inserted: word[i % word.length] });
  ev.push({ seq: n, t: n * 110 + 90, kind: 'delete_back', pos: n - 1, removed: word[(n - 1) % word.length] });
  return ev;
}

describe('certificate', () => {
  const keys = generateKeyPair();
  const secret = newSessionSecret();
  const events = sample();
  const cert = buildAttestation({
    events, finalText: finalText(events), metrics: deriveMetrics(events),
    sessionSecret: secret, privateKey: keys.privateKey, surface: 'test', createdUtc: '2026-10-10T19:00:00Z',
  });

  it('signs and verifies, and the id is the content hash', () => {
    expect(verifySignature(cert)).toBe(true);
    expect(cert.id).toBe(attestationId(bodyOf(cert)));
    expect(cert.author.public_key).toBe(keys.publicKey);
  });

  it('fails if any number is changed after signing', () => {
    const forged = { ...cert, metrics: { ...cert.metrics, chars_typed: cert.metrics.chars_typed + 100 } };
    expect(verifySignature(forged)).toBe(false);
  });

  it('fails under a different key', () => {
    const other = generateKeyPair();
    expect(verifySignature({ ...cert, author: { alg: 'ed25519', public_key: other.publicKey } })).toBe(false);
  });

  it('tampering one event changes the root', () => {
    const t = events.map((e) => ({ ...e }));
    t[3].inserted = 'X';
    expect(merkleRoot(t, secret)).not.toBe(cert.events_root);
  });

  it('a different session secret gives an unlinkable root for the same edits', () => {
    expect(merkleRoot(events, newSessionSecret())).not.toBe(cert.events_root);
  });
});

describe('selective disclosure', () => {
  const secret = newSessionSecret();
  for (const n of [1, 2, 5, 8, 13]) {
    it(`every leaf proves into the root (n=${n + 1})`, () => {
      const events = sample(n);
      const root = merkleRoot(events, secret);
      for (let i = 0; i < events.length; i++) {
        const d = disclose(events, secret, i);
        expect(d.events_root).toBe(root);
        expect(verifyDisclosure(d)).toBe(true);
      }
    });
  }
  it('a disclosed edit cannot be altered', () => {
    const events = sample(5);
    const d = disclose(events, secret, 2);
    expect(verifyDisclosure({ ...d, event: { ...d.event, inserted: 'Z' } })).toBe(false);
  });
});
