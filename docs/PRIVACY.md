# Privacy design rules

These rules are part of the protocol, not a policy page. Code that breaks them is a bug.

1. **Two purposes, separated in code.** *Process evidence* (did a session unfold this way) is the default. *Recognizing a person* from typing rhythm is a different purpose with different law; it is not implemented in v0 and, if added, will be a separate opt-in module with its own consent.
2. **No typing template by default.** Nothing in v0 builds a model of how a specific person types.
3. **Raw stays on the device.** The editor log and device key log live on your machine. A certificate carries counts, durations and a Merkle root — not timing vectors, not text.
4. **Device capture records key classes, never characters.** The terminal recorder and menu-bar app store `char`, `back`, `paste`, etc., never which key.
5. **Only a hash goes on-chain.** The anchor commits the sha256 of a signed certificate. Certificates are salted per session so two of your sessions can't be linked by their roots.
6. **You hold the certificate and choose to share it.** Merit never publishes on your behalf.
7. **No emotion or stress inference.** Pauses are counted, never interpreted as feelings.
8. **Say "evidence of," not "proof of,"** and publish error characteristics before making accuracy claims.
9. **Institution-mandated use** (an employer or school requiring capture) needs notice and consent flows before deployment; not a v0 use case.
10. **No recognition for minors.**
11. **Correct, never impose.** The review step offers corrections computed on the device. Nothing changes unless the author accepts. Each decision (accept = slip fixed, keep = deliberate style) is logged with its correction kind only, never the words. It is the author's own consent deepening their own record.

Background: research memo `2026-10-10-legal-scan` (not legal advice) covering BIPA, CUBI, Washington MHMDA, Colorado, CCPA/CPRA, GDPR Art. 9, the EU AI Act and FTC guidance.
12. **Measure only in chosen apps.** The desktop app measures only while an app on your list is in front (`~/.merit/apps.json`: terminals, editors, writing apps). Everything else, including password managers and banking sites, is ignored. On macOS, browsers can be listed because password fields trigger Secure Event Input, which Merit honors; on Windows and Linux there is no equivalent signal, so browsers are off the default list.
13. **No reset to look clean.** Records only append. There is no "restore to defaults" for merit; anchored certificates are permanent. You can stop measuring, revoke a key, or choose not to share — never rewrite what was certified.
