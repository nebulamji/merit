import { describe, expect, it } from 'vitest';
import { generateKeyPair, delegate, agentReceipt, countersign, verifyMutual } from '@merit/attest';
import { sha256Hex } from '@merit/spec';

describe('Know Your Agent: mutual receipts', () => {
  const human = generateKeyPair();
  const agent = generateKeyPair();
  const d = delegate(human.privateKey, agent.publicKey, 'code:merit-repo', '2026-12-31T23:59:59Z');
  const r = agentReceipt(agent.privateKey, d, {
    about_certificate: 'merit_cdee8ed5de9f24409ce7',
    work_sha256: sha256Hex('the diff the agent produced'),
    conduct: { directed_by_principal: true, within_terms: true, recoveries: 2 },
    created_utc: '2026-10-10T21:00:00Z',
  });
  const c = countersign(human.privateKey, r, 'accepted', '2026-10-10T21:05:00Z');

  it('verifies the full triangle', () => {
    const v = verifyMutual(d, r, c);
    expect(v.ok).toBe(true);
  });
  it('rejects an agent acting outside its delegation window', () => {
    const late = agentReceipt(agent.privateKey, d, { work_sha256: 'x', conduct: { directed_by_principal: true, within_terms: true, recoveries: 0 }, created_utc: '2027-02-01T00:00:00Z' });
    expect(verifyMutual(d, late).checks.within_delegation_window).toBe(false);
  });
  it('rejects a receipt signed by a different agent', () => {
    const impostor = generateKeyPair();
    const fake = agentReceipt(impostor.privateKey, d, { work_sha256: 'x', conduct: { directed_by_principal: true, within_terms: true, recoveries: 0 } });
    expect(verifyMutual(d, fake).checks.receipt_signed_by_agent).toBe(false);
  });
  it('rejects a tampered conduct claim', () => {
    const tampered = { ...r, conduct: { ...r.conduct, within_terms: false } };
    expect(verifyMutual(d, tampered, c).ok).toBe(false);
  });
});
