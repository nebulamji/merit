# Provenance: when Merit was made

Merit's own history is checkable the way Merit certificates are: by Bitcoin, not by trusting us. File dates and commit dates can be edited. A Bitcoin-confirmed timestamp cannot be created after the fact.

Each anchor below is an OpenTimestamps proof (`anchors/*.ots`) of a file that commits to a version of this project. Run the check yourself:

    pnpm install
    node scripts/verify-anchors.mjs

It re-derives each file's hash, replays the proof, and compares it with the public Bitcoin block. Verified 2026-10-16:

| Anchor | What it commits to | Bitcoin block | Confirmed (UTC) |
|---|---|---|---|
| `v0.1.0.sha256` | the first release of the code (source archive hash) | 970819 | 2026-10-10 20:08:32 |
| `whitepaper-draft-0.1.sha256` | whitepaper draft 0.1 | 970852 | 2026-10-11 00:33:46 |
| `whitepaper-0.1.1.sha256` | whitepaper 0.1.1 | 970871 | 2026-10-11 04:12:27 |
| `genesis.sha256` | Mark 0, the frozen paper the Book begins from | 970973 | 2026-10-11 19:36:40 |

A timestamp shows a file existed **no later than** its block, not that it was created at that moment. Together these show the project and its first release existed by 2026-10-10, days before this page.

## What this does not show
- Anything about the project before 2026-10-10.
- Who made it: a timestamp proves when, not who. Authorship is a separate claim, made by signed certificates (see the paper) and by the history of the people who recognize them.

See also [ANCHORS.md](ANCHORS.md) for how the timestamps are produced and the provenance note on this repository's public history.
