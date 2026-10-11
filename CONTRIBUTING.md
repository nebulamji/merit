# Contributing: build Merit, earn your mark

Merit is open source (Apache-2.0), and contributing to it is itself merit. The work of building Merit goes in the Book like any other work, and the Book pays the people in it.

## How a contribution becomes a mark
1. **Record while you work.** Run the Merit app (Measure integrity) or `merit-term rec -- <your editor or agent>` while you work on an issue. It records key types and timing only, never what you type.
2. **Sign it and open your pull request.** Stop & sign; the certificate is anchored in Bitcoin within hours. Mention the certificate id in your PR.
3. **Get recognized.** When a maintainer merges your PR, they recognize your certificate (`merit recognize`, or one click in the app's waiting list). You're in the Book.
4. **Set your wallet** in the app. From then on, your marks earn an equal share of every day's page auction and every Portfolio they appear in.

Every merged contribution can earn a mark: code, tests, docs, translations, calibration sessions (see `docs/CALIBRATION.md`), and design. Recognition is public: the Book draws a thread from the recognizer's mark to yours.

## Good first marks
Issues labeled **good first mark** are scoped for a first contribution. Calibration volunteers are especially valuable right now: four short sessions give the scoring standard the published error rates it needs.

## Rules that keep it honest
- One certificate, one mark. Recording a session you didn't actually work in is fabrication; the anchors, rhythm and recognitions make it costly, and a falsified mark stays in the Book as a falsified mark.
- Recognizers stake their own record: each recognition is signed and public. Recognize only work you have reason to stand behind.
- Nothing here is for sale. Marks can't be bought, transferred or sold.

## Development
`pnpm install && pnpm test` (TypeScript), `cd contracts && forge test` (Solidity), `cd apps/menubar/src-tauri && cargo test` (desktop). See README.md.
