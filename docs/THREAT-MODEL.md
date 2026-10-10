# Threat model (v0)

| Attack | What stops it | What doesn't (yet) |
|---|---|---|
| Edit the numbers after signing | Ed25519 signature over canonical JSON; content id | — |
| Swap the document | `doc_sha256` checked against the supplied text | — |
| Alter a disclosed edit | Merkle inclusion proof fails | — |
| Backdate a certificate | Bitcoin anchor shows it existed no later than its block | Can't prove it wasn't created *later than* claimed `created_utc` before anchoring; only "no later than" |
| Link a person's sessions by root | Per-session salt | Public key links certificates by design (that's the merit record) |
| **Synthesize a fake typing session** (a bot that types with human-like timing) | Nothing cryptographic in v0 | The core open problem. Mitigations planned: hardware-backed signing keys (Secure Enclave), OS-level capture attestations, continuity across many anchored sessions over time, cited outcomes (confidence) that a bot can't fake cheaply |
| Steal the signing key | Key file is 0600 on device | Hardware-backed keys planned; key rotation with anchored revocation |
| Paste into a recorder that can't see bracketed paste | Single-read bulk heuristic (≥ 8 printable chars) | Very slow "paste" via keystroke injection is indistinguishable from typing |

A certificate is **evidence of** a process. It is strongest in aggregate: many anchored sessions, consistent over time, whose outputs were later accepted or cited.
