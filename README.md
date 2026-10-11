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
| `apps/menubar` | Desktop menu-bar app (macOS, Windows, Linux). Measure · Stop & sign · dashboard that signs with your keychain key, anchors in Bitcoin, upgrades proofs, recognizes others and inscribes in the Book. No Node required. |
| `apps/site` | merit.artofficial.computer: the Book, the in-browser verifier, the paper |

## Use it

1. Install the app (`pnpm app:build`, or the installers built by CI). On macOS, allow it under *Privacy & Security → Input Monitoring*.
2. Menu bar → **Measure integrity**, write in any app on your list (`~/.merit/apps.json`), then **Stop & sign**.
3. The dashboard signs the session with your key (Keychain / Credential Manager / Secret Service, never shown to the page) and submits it to Bitcoin. A few hours later it confirms on its own.
4. **Inscribe** it in the Book at merit.artofficial.computer, with a recognition from someone already there, or by time (three anchored certificates over a week).

Isolated mode for tests or portable use: `MERIT_HOME=/some/dir merit-menubar` never touches the system keychain.

## Quick start (developers)

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

Build the CLI bundle: `pnpm exec esbuild packages/verify/src/cli.ts --bundle --platform=node --format=cjs --external:@napi-rs/keyring --outfile=dist/merit-cli.cjs`.

## What a certificate claims, and doesn't

It is **evidence of** a process, not proof of intent or authorship by a particular person. It shows: this key signed this record of how a session unfolded; the numbers derive deterministically from a committed event log; the record existed no later than its Bitcoin block. See `docs/THREAT-MODEL.md`.

## Contributing

Build Merit, earn your mark: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0. See `docs/PRIOR-ART.md` for the dated public record of these ideas.
