# merit-attestation/0.1

## Certificate
Canonical JSON (keys sorted at every depth, array order kept, undefined dropped, no whitespace).

| field | meaning |
|---|---|
| `schema` | `"merit-attestation/0.1"` |
| `doc_sha256` | sha256 of the final document text (UTF-8); sha256("") when no document is attached (device sessions) |
| `events_root` | Merkle root over salted event leaves |
| `event_count` | number of events |
| `metrics` | counts and shapes only (see `packages/spec`) incl. `forgiveness` and `source` (`content`/`keys`) |
| `author` | `{ alg: "ed25519", public_key: hex }` |
| `created_utc` | author's claim; the anchor is the trusted time |
| `surface` | e.g. `merit-editor/0.1`, `merit-term/0.1`, desktop app |
| `id` | `"merit_" + first 20 hex of sha256(canonical body)` (body = all fields except `id`, `signature`) |
| `signature` | Ed25519 over the canonical body bytes |

## Commitment
- `salt_i = sha256(session_secret ‖ ":" ‖ seq_i)`
- `leaf_i = sha256(0x00 ‖ salt_i ‖ canonical(event_i))`
- `node = sha256(0x01 ‖ left ‖ right)`; an odd last node is promoted unchanged.
- Disclosure = `{ event, salt, index, proof[{side, hash}], events_root }`.

## Anchor
OpenTimestamps over `sha256(canonical(certificate))` (the full signed certificate, `id` and `signature` included). Verify against public Bitcoin block headers.

## Event models
- `MeritEvent` (editors): `{ seq, t, kind: insert|delete_back|delete_fwd|replace|paste|cut|undo|redo, pos, removed?, inserted? }`
- `KeyEvent` (devices): `{ seq, t, k: char|space|enter|back|del|paste|nav|select|undo|cmd, n?, app? }` — never the character.

## Know Your Agent (mutual receipts)
- `merit-delegation/0.1`: principal signs `{principal, agent, scope, not_after_utc}`.
- `merit-agent-receipt/0.1`: agent signs `{delegation_sig, about_certificate?, work_sha256, conduct{directed_by_principal, within_terms, recoveries}, created_utc}`.
- `merit-countersign/0.1`: principal signs `{receipt_sig, verdict: accepted|rejected, created_utc}`.
The triangle is valid when all three signatures verify, each references the previous signature, and the receipt falls inside the delegation window. It records signed facts about the relationship (who directed, within terms, errors recovered), never anyone's mood. A portable record of good standing between a person and their agents.
