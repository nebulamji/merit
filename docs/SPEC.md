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

## Agent requests on the open web (Web Bot Auth)
`@merit/agentauth` signs HTTP requests per draft-meunier-web-bot-auth-architecture (RFC 9421 HTTP Message Signatures, Ed25519): components `@authority` and optionally `"signature-agent";key=…`; params `created`, `expires`, `keyid` (RFC 8037 JWK SHA-256 thumbprint), `alg="ed25519"`, `nonce`, `tag="web-bot-auth"`. `directory()` produces the JWKS served at `/.well-known/http-message-signatures-directory`. This is the format Cloudflare signed agents, Visa's Trusted Agent Protocol and Mastercard Agent Pay verify, so a Merit agent key works there unchanged.

Merit adds one header: `Merit-Delegation`, the base64url canonical JSON of the principal's signed delegation. A verifier that knows Web Bot Auth learns *which agent*; one that also reads Merit learns *on whose behalf, in what scope, until when*, and can later countersign the agent's receipt.

Conformance: both draft-05 Ed25519 vectors (A.2.1, A.2.2) reproduce byte-for-byte. Note on A.2.2: the draft prints the Signature-Agent member value quoted in the signature base (RFC 9421 §2.1.2), but its published signature verifies only over the bare URL. The signer defaults to the published-signature form (`agentValueForm: 'reference'`); verification accepts either.
