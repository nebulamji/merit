# Merit

**Evidence of how work was done.** When machines can produce the output, the output stops proving ability. Merit records the *process* — corrections, revisions, continuity, pastes, time — on your own device, signs it with a key only you hold, and anchors it to Bitcoin so anyone can check it later without trusting anyone.

- **First-party.** You attest your own work. No one records anyone else.
- **Private by construction.** Raw keystrokes never leave your device. Device capture stores the *class* of each key (char, space, back, paste…) and its timing, never the character.
- **Yours.** Your signing key is generated on your machine. Certificates are files you hold and choose to share.
- **Checkable.** A certificate verifies offline (signature, content id, document hash, any edit you disclose) and its anchor verifies against public Bitcoin block data.

Anti-cheating tools ask *"did a human write this?"* about one document. Merit keeps answering *"how does this person work?"* across everything they make — a record that compounds.

## What's here

| Package | Does |
|---|---|
| `packages/spec` | `merit-attestation/0.1` format, canonical JSON + sha256 content ids, event models (`MeritEvent` for editors, `KeyEvent` for devices) |
| `packages/capture` | Replay a log to the exact final text; derive metrics: corrections by class, revisions, bursts, pauses, paste share, **forgiveness** (corrections recovered from) |
| `packages/attest` | Ed25519 self-custody keys, signed certificates, salted Merkle commitment over every edit, single-edit disclosure proofs |
| `packages/verify` | Offline verifier, OpenTimestamps stamping/upgrade/verification, `merit` CLI |
| `packages/agentauth` | Web Bot Auth (RFC 9421) request signing for agent keys — passes the draft's official Ed25519 vectors — plus a `Merit-Delegation` header binding the agent to its principal |
| `packages/calibrate` | Error rates for a scoring standard on labeled composing / retyping / AI-retyping sessions, with Wilson intervals; refuses accuracy claims below the minimums (`docs/CALIBRATION.md`) |
| `packages/term` | `merit-term rec -- <cmd>`: record key classes typed into any terminal program (e.g. an AI coding agent) |
| `apps/menubar` | macOS menu-bar app: Start session · Stop & certify · Open dashboard |

## Quick start

```bash
pnpm install && pnpm test
# record yourself directing an agent in the terminal
python3 packages/term/merit_term.py rec --app claude -- claude
# sign it and anchor it
node dist/merit-cli.cjs certify ~/.merit/sessions/<session>.jsonl --stamp
node dist/merit-cli.cjs verify ~/.merit/sessions/<session>.cert.json
# hours later, once a Bitcoin block includes it
node dist/merit-cli.cjs upgrade ~/.merit/sessions/<session>.cert.json.ots
```

Build the CLI bundle: `node node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild packages/verify/src/cli.ts --bundle --platform=node --format=cjs --outfile=dist/merit-cli.cjs` (see `docs/SPEC.md`).

## What a certificate claims, and doesn't

It is **evidence of** a process, not proof of intent or authorship by a particular person. It shows: this key signed this record of how a session unfolded; the numbers derive deterministically from a committed event log; the record existed no later than its Bitcoin block. See `docs/THREAT-MODEL.md`.

## License

Apache-2.0. See `docs/PRIOR-ART.md` for the dated public record of these ideas.
