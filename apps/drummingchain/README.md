# DRUMMINGCHAIN — the practice instrument is a workchain

**Status:** working browser prototype, local only; mic transient estimates + optional manually aligned camera AR overlay + five-second local application blocks + ten-minute rounds + private practice receipts + a transparent rule-based practice companion. No on-chain deployment, signed certificate, independent sensor validation, ML inference, physical authentication, token, market, staking, or reward claim.

**Run:** use Node 22+: from the repository root, `cd apps/drummingchain && python3 -m http.server 8089 --bind 127.0.0.1`; open `http://127.0.0.1:8089`. For remote phones, deploy to an HTTPS origin because `getUserMedia` and AudioWorklet need a secure context. Click **START MIC**, optionally **CAMERA**, and tap on the pad in the video view to relocate the display target. Stop and export a JSON file to your machine. **TRY DEMO** emits clearly marked synthetic transients and never qualifies as evidence. Test with `node --test test/*.test.mjs`.

## Why this lives here

Review performed 2026-11-12, source links:
- `nebulamji/merit`: on-device process evidence, salted Merkle commitments, Ed25519 attestations, selective disclosure; reusable evidence rails, but existing schemas describe typing events, **not** physical drumming (see `docs/SPEC.md`, `packages/attest`, `packages/capture`).
- `nebulamji/piano-anon`: `Takes.sol` encodes musical events and append-only engine versions; recording and mint are separate decisions; undeployed/unaudited.
- `nebulamji/pianonymity`: live interactive music, visual generation, harmony rules, and the private CCW spiral drumming manual. Those embodied, poetic practice cues are **not** scientifically established diagnoses or sensor data.
- `nebulamji/jazzcats`: separate musical player, media/score transport and agent/musician world; `BandstandPlay` governs scoped participation; this application does not change its holders, audio, identity, or payment contracts.
- `nebulamji/MUSICTEACHERAI`: existing music-theory analysis and visualizer; may furnish a future explicit coaching adapter, not a verified or already integrated agent.

SQUEEKCHAIN's earlier structure was *sensor → signed measurements → 10-minute rounds → application blocks → Ethereum settlement, with gameplay/NFT layers*. Here we preserve the important separations, **not** the assumption that a microphone is a trustworthy sensor: `capture → measurement → optional review → time round → private receipt → independent verification → opt-in settlement`.

## Current data path

```
Evans pad + two sticks
     ↓ acoustic impulses (without identifying the player or individual sticks)
getUserMedia(audio) -> high-pass 160 Hz -> AudioWorklet 128-sample RMS/rise detector
     ↓ {time, strength estimate, source:'microphone', hand:'unknown'}
sensor-neutral normalizeHit() -> immutable sequenced local log
     ↓
deriveMetrics() + makeActivityBlocks(5 seconds) + partitionRounds(10 minutes)
     ↓
salted per-event SHA-256 binary commitment + local application-block hash chain + canonical receipt SHA-256
     ↓
private JSON download (raw hits + local secret + UNSIGNED_SELF_REPORTED receipt)
     ↓ NOT YET BUILT
Merit-signed attestation, optional public aggregate/selected disclosures
     ↓ NOT YET BUILT
independent validator / oracle / action authorization / chain settlement
```

**What is real:** AudioWorklet analyzes input locally; simulated events are tagged; the camera is a *view*, not a motion-tracking or stick-identification sensor. Every detected onset flashes an augmented ring around the manually positioned pad. Audio playback is zeroed. Nothing calls an external API. Raw PCM and camera frames are not retained in this app. Latency/threshold behavior is device-dependent and requires calibration, especially rolls, buzzes, flams and soft strokes. The displayed grid error is *phase-anchored to the first detected hit*, not synchronization with an audible metronome, musicality, groove or pedagogical quality. Observed strokes/minute is not tempo/BPM.

**What is not real:** Handedness, velocity calibration, grip, rebound, body mechanics, vision classification, teacher agreement, economic work validation, AR occlusion, avatar motion capture, on-chain proof, wallets, or $DRUMMINGCHAIN issuance.

## Protocol sketch (extensible, vendor-neutral)

`drummingchain-practice/0.1`:
- Event: `{seq, t_ms, strength:0..1, source:'microphone'|'midi'|'sensor'|'demo', hand:'L'|'R'|'unknown'}`. Source is an assertion, not guaranteed trustworthy.
- Metrics: count, duration, observed inter-hit median/CV, phase-relative subdivision error and source caveats.
- **Application block**: five-second locally chained event commitment with sequence index, event hash, previous block hash and explicit `UNANCHORED_LOCAL_CHAIN` status. Not an Ethereum block or proof of work.
- **Round**: ten-minute accounting bucket with start/end timestamps, hit count and event sequence references. Not an Ethereum consensus interval.
- Receipt: `events_root` from salted canonical-event leaf hashes, public aggregate metrics, `verification='UNSIGNED_SELF_REPORTED'`, chain fields null/false, `receipt_sha256`. This is *not* the Merit `merit-attestation/0.1` signed schema; it can be adapted through an explicit reviewed bridge.
- Private export includes the local secret and raw events **for replay on the owner's device only**. **Never upload that complete private export or secret to chain or a public art gallery.**
- For true third-party proof: independent witness devices / calibrated sensor attestations, timestamp authority, anti-replay nonce, liveness, attack resistance and a dispute path. Device self-signature alone proves key control, **not** a human played a pad.

## Capability roadmap

| Stage | Surface | Technically required / gating | Status |
|---|---|---|---|
| V0 | microphone + camera AR rings | AudioWorklet capture, local consent, event clock, ten-minute rounds, local hash | **Implemented in this folder** |
| V0.2 | stick tip and pad geometry | Camera calibration, pose/hand/stick keypoints, video-time to audio-time clock alignment, confidence/null handling, occlusion tests | Not implemented |
| V0.3 | drumming musician AI | Rule-based descriptive companion is active; actual AI teacher, notation-aware judgment and validated pedagogy need consent and musician-led benchmarks | Transparent companion implemented; AI model not implemented |
| V1 | interactive notation | Live two-staff sticking exercises, reading with generated alternatives, suggestions adaptive to actual input; never silently overwrite authored notation | Not implemented |
| V1.1 | AR/VR | WebXR in supported devices / three.js space, anchored 3D staff and rehearsal avatars; 2D fallback; per-device latency benchmark | Not implemented |
| V1.2 | evidence | Merit's signed receipt, challenger review, selectively disclosed per-event proof, trusted time and external calibration | Not implemented |
| V2 | network / SQUEEKCHAIN mechanic | Public application rounds, rewards for *externally validated* milestones, JazzCats rehearsal entry and governance scope | Design only |
| V3 | optional chain | Reviewed, audited, explicitly approved contract, replay protection, no self-verified mint farming, jurisdictional token review | Not authorized |

## Musical practice grammar

Practice is a **temporal score**, not a leaderboard counter. Versioned drills should cover singles, doubles, paradiddles, drag and flam families, timed roll development, sight-reading, metric modulation, subdivision switches, dynamic shaping, phrasing across barlines, and embodied rebound awareness. For advanced players: melodic drumming, ride-cymbal phrasing, polyrhythms, clave, counterpoint across limbs, and trading fours with AI musicians. A later model may *recommend* next material, or write a second simultaneous voice as a companion, while the user's own performance remains authoritative. Do not train or assert biomechanics from an unvalidated single photo. Annotate uncertainty, and never confuse motion-model aesthetics with clinical or pedagogical truth.

## Economic boundaries

`$DRUMMINGCHAIN` is **the proposed name for a possible economic layer**, not a deployed token or security. Counting strokes is trivially farmable and should never trigger automatic tokens, sales or on-chain badges worth money. Distinguish **activity**, **skill improvement**, **verifiable contribution**, **artistic collaboration** and **settled economic reward**. Qualified reward criteria require external validation, replay protection, privacy-preserving sampling, anti-Sybil review and a permitted legal design. If used in JazzCats, label it as one in-world **Practice / Performance feature** rather than another competing public ecosystem.

## Security and evaluation

- Capture requires explicit browser permission. Stop closes microphone tracks and AudioContext; camera is separately permissioned.
- No live stream leaves this application. No wallet or API keys are requested. No external libraries, fonts or analytics.
- Demo source contaminates the entire receipt; never promote to validated status.
- Local `created_utc` can be tampered with; only a trusted anchor can provide durable time evidence.
- Voice recognition, handedness, velocity, biomechanical or neurological claims are excluded.
- Audio detection is a heuristic: benchmark against manually labeled recordings across pads, rooms, devices and tempi; report false positives, false negatives, mean/95th-percentile timestamp errors, roll resolution and domain shifts; do not publish calibrated accuracy until measured.
- Future chain adapter must never accept raw untrusted hit-count as mint authority; validate replay, round boundaries, permissions, conservation of payouts, capped incentive issuance and offline-first consent.
