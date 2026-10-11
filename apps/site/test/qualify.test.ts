import { describe, expect, it } from 'vitest';
import { generateKeyPair, newSessionSecret, buildAttestation, recognize } from '@merit/attest';
import type { Metrics } from '@merit/spec';
import { workFloor, recognitionClaim, anchorClaim } from '../src/qualify';

const metrics = (typed: number, pasted = 0) => ({ session_ms: 60000, active_ms: 60000, chars_typed: typed, chars_pasted: pasted, paste_events: pasted ? 1 : 0, max_paste_len: pasted,
  corrections: { deletions: 3, typo_fixes: 1, word_changes: 0, restructures: 0 }, revisions: 0, bursts: 3, pauses_over_2s: 1, longest_pause_ms: 3000,
  final_chars: typed + pasted, typed_share: typed / Math.max(1, typed + pasted), forgiveness: 1, source: 'keys' }) as unknown as Metrics;
const cert = (k: string, m: Metrics) => buildAttestation({ events: [], finalText: '', metrics: m, sessionSecret: newSessionSecret(), privateKey: k, surface: 'test' });

describe('Book qualification', () => {
  const a = generateKeyPair(), b = generateKeyPair(), founder = generateKeyPair();
  it('work floor: enough typing, mostly typed', () => {
    expect(workFloor(cert(a.privateKey, metrics(300)))).toBeNull();
    expect(workFloor(cert(a.privateKey, metrics(100)))).toMatch(/250/);
    expect(workFloor(cert(a.privateKey, metrics(300, 900)))).toMatch(/mostly typed/);
  });
  it('recognition: founder exempt, others need a valid recognizer who is not themselves', () => {
    const c = cert(a.privateKey, metrics(300));
    expect(recognitionClaim(cert(founder.privateKey, metrics(300)), undefined, founder.publicKey)).toBeNull();
    expect(recognitionClaim(c, undefined, founder.publicKey)).toMatch(/recognition/);
    expect(recognitionClaim(c, recognize(b.privateKey, c.id), founder.publicKey)).toBeNull();
    expect(recognitionClaim(c, recognize(a.privateKey, c.id), founder.publicKey)).toMatch(/yourself/);
    expect(recognitionClaim(c, recognize(b.privateKey, 'merit_other'), founder.publicKey)).toMatch(/does not verify/);
  });
  it('anchor: refuses garbage proofs', () => {
    expect(anchorClaim(cert(a.privateKey, metrics(300)), new Uint8Array([1, 2, 3]))).toMatch(/unreadable/);
  });
});
