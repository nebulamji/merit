/**
 * DRUMMINGCHAIN v0.1 — deterministic, sensor-neutral practice accounting.
 * Raw measurement stays local. Audio transients are not proof of who played.
 * No spend, mint, token issuance or financial claim is authorized here.
 */
export const SCHEMA = 'drummingchain-practice/0.1';
export const ROUND_MS = 600_000;
export const VALID_SOURCES = new Set(['microphone', 'midi', 'sensor', 'demo']);

const round = (n, places = 2) => Number(n.toFixed(places));
export const median = (xs) => {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};

export function normalizeHit(input, sequence) {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new RangeError('invalid sequence');
  const tMs = Number(input.tMs);
  const strength = Number(input.strength ?? 0);
  const source = input.source || 'microphone';
  const hand = input.hand || 'unknown';
  if (!Number.isFinite(tMs) || tMs < 0 || tMs > 86_400_000) throw new RangeError('invalid hit time');
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new RangeError('invalid strength');
  if (!VALID_SOURCES.has(source)) throw new RangeError('invalid source');
  if (!['L', 'R', 'unknown'].includes(hand)) throw new RangeError('invalid hand');
  return { seq: sequence, t_ms: round(tMs, 3), strength: round(strength, 3), source, hand };
}

export function deriveMetrics(hits, durationMs, tempoBpm = 100) {
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 86_400_000) throw new RangeError('invalid duration');
  if (!Number.isFinite(tempoBpm) || tempoBpm < 20 || tempoBpm > 400) throw new RangeError('invalid tempo');
  const sorted = [...hits].sort((a, b) => a.t_ms - b.t_ms || a.seq - b.seq);
  const gaps = sorted.slice(1).map((h, i) => h.t_ms - sorted[i].t_ms).filter((x) => x >= 0);
  const med = median(gaps);
  const mean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  const deviation = mean && gaps.length > 1
    ? Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length) / mean
    : null;
  const beatMs = 60_000 / tempoBpm;
  // Phase is anchored to first observed strike; this measures within-session regularity,
  // NOT absolute synchronization to an external metronome or musical accuracy.
  const first = sorted[0]?.t_ms || 0;
  const halfBeat = beatMs / 2;
  const timingErrors = sorted.map((h) => {
    const phase = ((h.t_ms - first) % halfBeat + halfBeat) % halfBeat;
    return Math.min(phase, halfBeat - phase);
  });
  const avgTiming = timingErrors.length ? timingErrors.reduce((a, b) => a + b, 0) / timingErrors.length : null;
  return {
    event_count: sorted.length,
    duration_ms: round(durationMs, 1),
    tempo_target_bpm: tempoBpm,
    observed_median_interhit_ms: med === null ? null : round(med),
    observed_strokes_per_min: med > 0 ? round(60_000 / med) : null,
    interhit_cv: deviation === null ? null : round(deviation, 4),
    relative_grid_error_ms: avgTiming === null ? null : round(avgTiming),
    demo_events: sorted.filter((h) => h.source === 'demo').length,
    hand_tracking_available: sorted.some((h) => h.hand !== 'unknown'),
    note: 'Audio events are estimated strikes; relative grid anchored to first hit; not identity or physical proof.',
  };
}

export function partitionRounds(hits, durationMs, roundMs = ROUND_MS) {
  if (!(roundMs > 0 && Number.isSafeInteger(roundMs))) throw new RangeError('invalid round size');
  const count = Math.ceil(durationMs / roundMs);
  return Array.from({ length: count }, (_, n) => {
    const start = n * roundMs;
    const end = Math.min((n + 1) * roundMs, durationMs);
    const events = hits.filter((h) => h.t_ms >= start && (h.t_ms < end || (n === count - 1 && h.t_ms === end)));
    return { index: n, start_ms: start, end_ms: end, event_count: events.length, event_seq: events.map((h) => h.seq) };
  });
}

export function canonicalJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().filter((k) => value[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + canonicalJSON(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
const bytes = (s) => new TextEncoder().encode(s);
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(value) {
  return hex(await globalThis.crypto.subtle.digest('SHA-256', bytes(value)));
}

/** Hashes are evidence commitments, not identity checks or a trusted time source. */
export async function commitEvents(hits, sessionSecret) {
  if (!/^[0-9a-f]{64}$/.test(sessionSecret)) throw new RangeError('session secret must be 32 bytes hex');
  const leafs = [];
  for (const event of hits) {
    const salt = await sha256Hex(sessionSecret + ':' + event.seq);
    const leaf = await sha256Hex('DRUMMINGCHAIN_LEAF_V1:' + salt + ':' + canonicalJSON(event));
    leafs.push(leaf);
  }
  if (!leafs.length) return sha256Hex('DRUMMINGCHAIN_EMPTY_V1');
  let level = leafs;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      // Odd node is carried unchanged; match a simple binary Merkle convention.
      next.push(i + 1 < level.length
        ? await sha256Hex('DRUMMINGCHAIN_NODE_V1:' + level[i] + ':' + level[i + 1])
        : level[i]);
    }
    level = next;
  }
  return level[0];
}

export async function localReceipt({ hits, durationMs, tempoBpm, sessionSecret, createdUtc }) {
  const events_root = await commitEvents(hits, sessionSecret);
  const metrics = deriveMetrics(hits, durationMs, tempoBpm);
  const body = {
    schema: SCHEMA, created_utc: createdUtc,
    session_duration_ms: round(durationMs, 1), events_root,
    events_count: hits.length, rounds: partitionRounds(hits, durationMs),
    metrics, sensor: hits.some((h) => h.source === 'demo') ? 'includes-demo' : 'untrusted-local-capture',
    verification: 'UNSIGNED_SELF_REPORTED',
    chain: { network: null, transaction: null, settled: false },
  };
  return { ...body, receipt_sha256: await sha256Hex(canonicalJSON(body)) };
}

export function newSecret() {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return hex(b);
}
