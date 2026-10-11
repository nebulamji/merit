import { describe, expect, it } from 'vitest';
import { generateKeyPair, newSessionSecret, buildAttestation } from '@merit/attest';
import type { Metrics } from '@merit/spec';
import { earnedClaim, EARN } from '../src/qualify';

const m = (typed: number) => ({ session_ms: 1, active_ms: 1, chars_typed: typed, chars_pasted: 0, paste_events: 0, max_paste_len: 0,
  corrections: { deletions: 0, typo_fixes: 0, word_changes: 0, restructures: 0 }, revisions: 0, bursts: 1, pauses_over_2s: 0, longest_pause_ms: 0,
  final_chars: typed, typed_share: 1, forgiveness: 0, source: 'keys' }) as unknown as Metrics;
let n = 0;
const cert = (k: string, typed = 300) => buildAttestation({ events: [], finalText: '', metrics: m(typed), sessionSecret: newSessionSecret(), privateKey: k, surface: 'test', createdUtc: new Date(Date.UTC(2026, 9, 1) + ++n * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z') });

describe('earned by time', () => {
  const a = generateKeyPair(), b = generateKeyPair();
  const primary = cert(a.privateKey);
  const claims = [{ height: 900000, root: 'x' }];
  it('needs enough certificates', () => {
    expect(earnedClaim(primary, claims, [])).toMatch(new RegExp(`${EARN.certificates} of your own`));
  });
  it('refuses another key’s certificates, duplicates, and thin work', () => {
    const junk = new Uint8Array([0]);
    expect(earnedClaim(primary, claims, [{ certificate: cert(b.privateKey), ots: junk }, { certificate: cert(a.privateKey), ots: junk }])).toMatch(/same key/);
    const c2 = cert(a.privateKey);
    expect(earnedClaim(primary, claims, [{ certificate: c2, ots: junk }, { certificate: c2, ots: junk }])).toMatch(/twice/);
    expect(earnedClaim(primary, claims, [{ certificate: cert(a.privateKey, 10), ots: junk }, { certificate: cert(a.privateKey), ots: junk }])).toMatch(/250/);
  });
  it('refuses unanchored history', () => {
    expect(earnedClaim(primary, claims, [{ certificate: cert(a.privateKey), ots: new Uint8Array([1]) }, { certificate: cert(a.privateKey), ots: new Uint8Array([1]) }])).toMatch(/unreadable/);
  });
});
