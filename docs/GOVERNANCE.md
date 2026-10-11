# Governance: what counts as merit

Merit separates three layers, and governs them differently.

1. **The grammar (open).** What a valid certificate is: the event models, the metrics, the canonical form, the signature and anchor rules. Defined in `SPEC.md` and the code. Anyone can implement it.
2. **The scoring standards (versioned).** How raw metrics become a score — e.g. a triple of *time* (active minutes × continuity), *forgiveness* (slips absorbed) and *confidence* (anchored work later accepted, verified or cited). v0 ships raw metrics only. A scoring standard is admitted only when it is published with its definition, calibration set, known failure modes and version, and it never changes past certificates.
3. **The admission rules (this document).** Which scoring standards are recognized, and how one is retired. Changes require a public proposal, a comment period, and a dated, anchored decision record.

**Rules that bind the system, not the people using it:**
- A score must be read from records, never self-reported.
- A score that never drops is worthless; standards must be able to go down.
- No standard may use emotion inference, protected traits, or data the person didn't choose to certify.
- Merit records are not transferable. Merit you can buy isn't merit.

## Standards log
| standard | status | notes |
|---|---|---|
| `composition/0.1-experimental` | retired 2026-10-10 | Penalized fluent writers: weighted word-level planning pauses heavily. On the first real composing session it read "mixed" (false negative). |
| `composition/0.2-experimental` | active, uncalibrated | Weights rework (deletions per 100 chars), uneven rhythm, revisions and thinking breaks at boundaries; word-level planning down-weighted; refuses to judge under 50 words. Calibration needed: volunteers' composing AND retyping samples, published error rates, before any claim. |
