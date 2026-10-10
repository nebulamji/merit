import { describe, expect, it } from 'vitest';
import type { MeritEvent } from '@merit/spec';
import { deriveMetrics, finalText } from '@merit/capture';
import { generateKeyPair, newSessionSecret, buildAttestation, disclose } from '@merit/attest';
import { verifyCertificate, stamp, checkAnchor } from '@merit/verify';

const events: MeritEvent[] = Array.from('merit').map((ch, i) => ({ seq: i, t: i * 150, kind: 'insert' as const, pos: i, inserted: ch }));
const keys = generateKeyPair();
const secret = newSessionSecret();
const text = finalText(events);
const cert = buildAttestation({ events, finalText: text, metrics: deriveMetrics(events), sessionSecret: secret, privateKey: keys.privateKey, surface: 'test' });

describe('verifyCertificate (offline)', () => {
  it('passes a genuine certificate with its text and a disclosed edit', async () => {
    const r = await verifyCertificate({ cert, text, disclosures: [disclose(events, secret, 2)], network: false });
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/^VALID/);
  });
  it('fails if the document was edited after signing', async () => {
    const r = await verifyCertificate({ cert, text: text + '!', network: false });
    expect(r.ok).toBe(false);
    expect(r.checks.document_matches).toBe(false);
  });
  it('fails a disclosure from a different session', async () => {
    const r = await verifyCertificate({ cert, disclosures: [disclose(events, newSessionSecret(), 1)], network: false });
    expect(r.ok).toBe(false);
  });
});

// Network: real OpenTimestamps calendars. Run with MERIT_NET=1.
describe.skipIf(!process.env.MERIT_NET)('anchoring (network)', () => {
  it('stamps and reports pending', async () => {
    const ots = await stamp(cert);
    expect(ots.length).toBeGreaterThan(100);
    const a = await checkAnchor(cert, ots);
    expect(['pending', 'bitcoin']).toContain(a.status);
  }, 60000);
});
