import { describe, expect, it } from 'vitest';
import { canonicalJSON, sha256Hex, attestationId, type AttestationBody } from '@merit/spec';

describe('canonicalJSON', () => {
  it('sorts keys at every depth and keeps array order', () => {
    expect(canonicalJSON({ b: 1, a: { d: [3, 1], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,1]},"b":1}');
  });
  it('drops undefined and rejects non-finite numbers', () => {
    expect(canonicalJSON({ a: undefined, b: 2 })).toBe('{"b":2}');
    expect(() => canonicalJSON({ a: NaN })).toThrow();
  });
  it('is independent of key insertion order', () => {
    expect(canonicalJSON({ x: 1, y: 2 })).toBe(canonicalJSON({ y: 2, x: 1 }));
  });
});

describe('sha256Hex golden vectors', () => {
  it('matches the standard test vector', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('attestationId', () => {
  const body: AttestationBody = {
    schema: 'merit-attestation/0.1',
    doc_sha256: sha256Hex('hello'),
    events_root: '00'.repeat(32),
    event_count: 0,
    metrics: {
      session_ms: 0, active_ms: 0, chars_typed: 0, chars_pasted: 0, paste_events: 0, max_paste_len: 0,
      corrections: { deletions: 0, typo_fixes: 0, word_changes: 0, restructures: 0 },
      revisions: 0, bursts: 0, pauses_over_2s: 0, longest_pause_ms: 0, final_chars: 5, typed_share: 0,
    },
    author: { alg: 'ed25519', public_key: 'aa' },
    created_utc: '2026-10-10T00:00:00Z',
    surface: 'test',
  };
  it('is deterministic and prefixed', () => {
    const id = attestationId(body);
    expect(id).toMatch(/^merit_[0-9a-f]{20}$/);
    expect(attestationId(JSON.parse(JSON.stringify(body)))).toBe(id);
  });
  it('changes when any field changes', () => {
    expect(attestationId({ ...body, event_count: 1 })).not.toBe(attestationId(body));
  });
});
