import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  SCHEMA, ROUND_MS, normalizeHit, deriveMetrics, partitionRounds,
  canonicalJSON, commitEvents, localReceipt, newSecret,
} from '../src/engine.mjs';

globalThis.crypto ??= webcrypto;

test('normalizes a hit, rejects impossible or untrusted fields', () => {
  assert.deepEqual(normalizeHit({ tMs: 12.3429, strength: .54269 }, 0),
    { seq: 0, t_ms: 12.343, strength: .543, source: 'microphone', hand: 'unknown' });
  assert.throws(() => normalizeHit({ tMs: -3, strength: .4 }, 0));
  assert.throws(() => normalizeHit({ tMs: 1, strength: 1.01 }, 0));
  assert.throws(() => normalizeHit({ tMs: 1, strength: .4, source: 'oracle' }, 0));
  assert.throws(() => normalizeHit({ tMs: 1, hand: 'LEFT' }, 0));
});

test('deterministic metrics do not mislabel physical identity or timing-to-click accuracy', () => {
  const events = [0,250,500,750,1000].map((tMs,i) => normalizeHit({ tMs, strength:.5 },i));
  const m = deriveMetrics(events, 1500, 120);
  assert.equal(m.observed_strokes_per_min,240);
  assert.equal(m.relative_grid_error_ms,0);
  assert.equal(m.hand_tracking_available,false);
  assert.equal(m.event_count,5);
  assert.equal(m.demo_events,0);
  assert.ok(m.note.includes('not identity'));
});

test('ten minute rounds partition exact boundaries deterministically', () => {
  const events = [100, ROUND_MS-1, ROUND_MS, 2*ROUND_MS-1].map((tMs,i) => normalizeHit({ tMs },i));
  const rounds = partitionRounds(events, 2*ROUND_MS);
  assert.deepEqual(rounds.map((x) => x.event_count),[2,2]);
  assert.deepEqual(rounds[1].event_seq,[2,3]);
  assert.deepEqual(partitionRounds([],0),[]);
});

test('round metadata handles final exactly-timed edge hit', () => {
  const events = [normalizeHit({ tMs: ROUND_MS },0)];
  assert.equal(partitionRounds(events,ROUND_MS)[0].event_count,1);
});

test('canonical serialization is key-order independent', () => {
  assert.equal(canonicalJSON({z:2,a:{y:[1,2],x:'yes'}}),
               canonicalJSON({a:{x:'yes',y:[1,2]},z:2}));
});

test('salt changes private event commitment, even with identical hits', async () => {
  const events = [normalizeHit({tMs:12,strength:.5},0)];
  const one = await commitEvents(events,'a'.repeat(64));
  const two = await commitEvents(events,'b'.repeat(64));
  assert.match(one,/^[0-9a-f]{64}$/);
  assert.notEqual(one,two);
  assert.equal(one,await commitEvents(events,'a'.repeat(64)));
});

test('private local receipt flags demo and explicitly declines chain/signature claims', async () => {
  const events = [normalizeHit({tMs:120,strength:.5,source:'demo'},0)];
  const r = await localReceipt({hits:events,durationMs:500,tempoBpm:100,
    sessionSecret:newSecret(), createdUtc:'2026-11-12T00:00:00.000Z'});
  assert.equal(r.schema,SCHEMA);
  assert.equal(r.sensor,'includes-demo');
  assert.equal(r.verification,'UNSIGNED_SELF_REPORTED');
  assert.equal(r.chain.settled,false);
  assert.equal(r.rounds.length,1);
  assert.match(r.receipt_sha256,/^[0-9a-f]{64}$/);
});
