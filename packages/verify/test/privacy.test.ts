import { describe, expect, it } from 'vitest';
import type { KeyEvent } from '@merit/spec';
import { deriveKeyMetrics } from '@merit/capture';
import { generateKeyPair, newSessionSecret, buildAttestation } from '@merit/attest';
import { privacyLint } from '../src/cli';

describe('privacy lint (refuses anything but key types)', () => {
  it('accepts a clean key session', () => {
    expect(privacyLint([{ seq: 0, t: 1, k: 'char' }, { seq: 1, t: 2, k: 'paste', n: 12, app: 'term:claude' }])).toEqual([]);
  });
  it('refuses a session carrying a character or text', () => {
    expect(privacyLint([{ seq: 0, t: 1, k: 'a' }]).length).toBe(1);
    expect(privacyLint([{ seq: 0, t: 1, k: 'char', text: 'hello' }]).length).toBe(1);
    expect(privacyLint([{ seq: 0, t: 1, k: 'paste', n: 'secret' }]).length).toBe(1);
  });
});

describe('a certificate carries no text', () => {
  it('has only numbers, hashes, the public key and fixed labels', () => {
    const keys: KeyEvent[] = ['upper', 'char', 'punct', 'space', 'char'].map((k, i) => ({ seq: i, t: i * 100, k: k as KeyEvent['k'] }));
    const kp = generateKeyPair();
    const cert = buildAttestation({ events: keys, finalText: '', metrics: deriveKeyMetrics(keys), sessionSecret: newSessionSecret(), privateKey: kp.privateKey, surface: 'merit-term/0.1' });
    const strings: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (typeof v === 'string') strings.push(path);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    };
    walk(cert, '');
    expect(strings.sort()).toEqual(['author.alg', 'author.public_key', 'created_utc', 'doc_sha256', 'events_root', 'id', 'metrics.source', 'schema', 'signature', 'surface'].sort());
  });
});
