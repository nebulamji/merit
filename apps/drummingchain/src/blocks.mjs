import { sha256Hex, canonicalJSON } from './engine.mjs';
export const ACTIVITY_BLOCK_MS = 5_000;
/**
 * 5-second application blocks, not Ethereum protocol blocks.
 * The chain is locally deterministic and tamper-evident once independently anchored,
 * but can always be fabricated by an adversarial client.
 */
export async function makeActivityBlocks({ hits, durationMs, sessionId, previousRoot = null }) {
  if (!/^[0-9a-f]{32,64}$/.test(sessionId)) throw new RangeError('invalid session id');
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 86_400_000) throw new RangeError('invalid duration');
  const sorted = [...hits].sort((a,b) => a.t_ms - b.t_ms || a.seq-b.seq);
  const blocks = [];
  let previous = previousRoot;
  for (let index=0; index < Math.ceil(durationMs/ACTIVITY_BLOCK_MS); index++) {
    const from = index*ACTIVITY_BLOCK_MS;
    const to = Math.min(durationMs,from+ACTIVITY_BLOCK_MS);
    const blockHits = sorted.filter((h) => h.t_ms >= from && (h.t_ms < to || (to === durationMs && h.t_ms === to)));
    const body = {
      schema:'drummingchain-appblock/0.1',
      session_id:sessionId,
      index, from_ms:from,to_ms:to,
      prev_hash:previous,
      hit_count:blockHits.length,
      observed_sequence: blockHits.map((h)=>h.seq),
      // Hash event canonicalization; values remain on the device unless export is requested.
      events_sha256: await sha256Hex(canonicalJSON(blockHits))
    };
    const hash = await sha256Hex(canonicalJSON(body));
    blocks.push({...body, hash});
    previous=hash;
  }
  return { blocks, tip:previous, status:'UNANCHORED_LOCAL_CHAIN' };
}
