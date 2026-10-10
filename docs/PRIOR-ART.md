# Prior art and defensive publication

This repository, and each tagged release of it, is published as prior art. Its contents are free to use under Apache-2.0, and its dated, Bitcoin-anchored history is intended to prevent anyone from patenting the methods it describes.

## Dated record of the ideas

| Date (ET) | Idea | Evidence |
|---|---|---|
| 2026-04-20 → 04-22 | Agent self-scoring against a ledger; confidence as settlement probability (0.89 → 0.62 from payment records) | *Paper 050*, *Receipt: 0.89, then 0.62* (dated to original commits; Proof Ledger) |
| 2026-05-23 | "Typing is imperfect"; "the delete button shouldn't exist" — keep corrections as signal | author's dated session logs |
| 2026-05-24 | Keystroke-process identity: do not correct the human, sign them; timing and rhythm as identity; zero-knowledge attestation | author's dated session logs and specs |
| 2026-05-23/24 | Confidence, forgiveness and inspection scores on every output; sound/music as an identity and trust substrate | author's dated session logs |
| 2026-10-10 | Merit harness: process capture → derived metrics (incl. forgiveness) → signed certificate → salted Merkle commitment with single-edit disclosure → OpenTimestamps/Bitcoin anchor → offline verification; device-level key-class capture (terminal wrapper, menu-bar app) | this repository's history; foundations document anchored via OpenTimestamps |

## Methods disclosed here

- Recording editing *process* as typed events (insert, deletion, selection overwrite, paste, undo) and deriving correction classes (typo fix, word change, restructure), revisions, bursts, pauses and typed-vs-pasted share by deterministic replay.
- **Forgiveness**: the share of correction runs after which composition resumes within a window, as a measure of absorbed vs abandoned slips.
- Device-level capture of **key classes** (not characters) with timing, from a pseudo-terminal wrapper or an OS event tap, as privacy-preserving process evidence.
- A per-session **salted Merkle commitment** over every edit, allowing any single edit to be disclosed with an inclusion proof without revealing the others, and preventing linkage between sessions.
- An author-held Ed25519 key signing a canonical-JSON certificate whose id is its content hash.
- Anchoring the certificate digest via **OpenTimestamps** to Bitcoin and verifying with public block data.
- Accumulating certificates into a portable **merit record** that later authorizations can cite (precedent), with scoring standards admitted through published governance.

Each release tag's source archive sha256 is listed in `ANCHORS.md` with its OpenTimestamps proof.
