import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { normalizeHit } from '../src/engine.mjs';
import { makeActivityBlocks } from '../src/blocks.mjs';
import { practiceCoach } from '../src/coach.mjs';
globalThis.crypto ??= webcrypto;
const id='0123456789abcdef0123456789abcdef';
test('five-second application blocks carry chained hashes with boundary hits in one block',async()=>{
  const hits=[0,4999,5000,10000].map((tMs,i)=>normalizeHit({tMs,strength:.5},i));
  const a=await makeActivityBlocks({hits,durationMs:10000,sessionId:id});
  const b=await makeActivityBlocks({hits,durationMs:10000,sessionId:id});
  assert.deepEqual(a,b);
  assert.equal(a.blocks.length,2);
  assert.deepEqual(a.blocks.map(x=>x.hit_count),[2,2]);
  assert.deepEqual(a.blocks[1].observed_sequence,[2,3]);
  assert.equal(a.blocks[1].prev_hash,a.blocks[0].hash);
  assert.equal(a.tip,a.blocks[1].hash);
  assert.equal(a.status,'UNANCHORED_LOCAL_CHAIN');
});
test('no phantom blocks; rejects malformed session identities',async()=>{
  const empty=await makeActivityBlocks({hits:[],durationMs:0,sessionId:id});
  assert.equal(empty.tip,null);
  assert.deepEqual(empty.blocks,[]);
  await assert.rejects(makeActivityBlocks({hits:[],durationMs:2000,sessionId:'oops'}));
});
test('practice companion labels demos and uncertainty',()=>{
  const demo=practiceCoach({event_count:20,demo_events:20,interhit_cv:.1},'rudiments');
  assert.equal(demo.confidence,'demo');
  const noData=practiceCoach({event_count:2,demo_events:0,interhit_cv:null},'rudiments');
  assert.equal(noData.confidence,'low');
  const varied=practiceCoach({event_count:20,demo_events:0,interhit_cv:.8},'free');
  assert.equal(varied.confidence,'descriptive');
});
