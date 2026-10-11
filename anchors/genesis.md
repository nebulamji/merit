# Merit: A Peer-to-Peer Electronic Proof-of-Process System

**Kyle Benford** · Public draft 0.2, October 2026 (draft 0.1 timestamped 2026-10-10 and anchored in Bitcoin)

## Abstract

A purely peer-to-peer system of merit would let a person's record of how they work be checked by anyone, without going through a school, a credentialing body or a detection vendor. Digital signatures and timestamps provide part of the solution, but the main benefit is lost if a trusted institution is still required to say whose work is whose. Artificial intelligence makes the problem urgent: outputs can now be produced without the ability they used to prove, so an output no longer shows that its author could make it. We propose a solution using proof-of-process. A person's own device records the shape of how work is done — corrections, revisions, pauses, pastes, timing, never the content — and the person signs it with a key only they hold. Each record is committed to a Merkle tree, timestamped in the Bitcoin blockchain so that it cannot be backdated, and accumulated into a personal book that only appends. Recognition by independent counterparties moves a claim from hypothesis to evidence to title to covenant. Credit is not a global score: each peer computes it from settled records, relative to its own anchor. As long as forging a record costs more real time, more modalities and more independent recognition than it would earn, honest records outweigh forged ones. The system requires no currency of its own and no global ledger beyond the timestamp chain it borrows. Merit is never for sale; the art made from the record pays the people in it.

## 1. Introduction

Merit has come to rely almost exclusively on institutions serving as trusted third parties: schools issue degrees, platforms assign ratings, vendors run detectors that guess whether a human wrote a document. Each works well enough for most cases, and each suffers from the weakness of the trust-based model. A degree certifies hours in a building, not what the holder can do. A rating belongs to the platform, which can revise or delete it. A detector issues probabilistic accusations that its subject cannot inspect. The costs are structural: merit cannot be carried between institutions, cannot be audited by the person it describes, and is denominated in credentials whose price has drifted away from the ability they certify.

Generative models break the remaining link. When a model can produce the essay, the proof, the code or the song, the output stops proving the ability that used to stand behind it. Institutions keep allocating grades, jobs and capital on outputs, and the link between those outputs and the people presenting them weakens every year.

What is needed is a system of merit based on evidence of process instead of trust in institutions, allowing any two parties to check how work was done without a third party. In this paper we propose such a system: process is recorded on the person's own device, signed by the person, committed so that any single step can later be disclosed without revealing the rest, and anchored in Bitcoin so the record's order in time can never be rewritten. The system is evidence, not proof of authorship; its strength is cumulative, across sessions, modalities and recognitions.

The design rests on one premise from earlier work: meaning that matters is enacted, not merely stated. Symbols are reversible and cheap to copy; acts are irreversible and costly to fake. A system of merit should therefore measure acts.

## 2. Certificates

We define a certificate as a signed summary of one session of work. The session's events are recorded on the device as types and timings — a letter, a capital, a punctuation mark, a deletion, a selection, a paste — never the characters themselves. From the events, deterministic functions derive counts: how much was typed, how much was pasted, how many slips were corrected and of what kind, how much was revised, how the time was spent. The certificate carries these counts, a hash of the finished document if one is attached, a Merkle root over the events, and the author's public key, and is signed by the author's private key. Its identifier is its own content hash: the hash is the name.

A certificate proves who signed a record of a session and that the numbers follow from a committed log. It does not by itself prove the session was real; a forger can sign a fabricated log. Section 4 addresses what makes fabrication costly; Section 12 estimates the cost.

## 3. Timestamp Server

The system borrows its timestamp server instead of building one. The hash of each certificate is submitted to public OpenTimestamps calendars, which aggregate many hashes into a Merkle tree and commit its root to a Bitcoin transaction. The resulting proof shows the certificate existed no later than the block that confirmed it, verifiable by anyone with the certificate and public block data. Each later timestamp reinforces the order of the earlier ones.

This gives the single property merit cannot do without and institutions cannot provide: a record that cannot be backdated. A history that claims a year of work must have been anchored over a year.

## 4. Proof-of-Process

Bitcoin's proof-of-work was deliberately useless: the work had no value except its cost, so that cost could be measured cleanly. Proof-of-process inverts this. The work is the person's real work, and the proof is a side effect of doing it. Nothing is burned.

The evidence is the shape of a process that a copy does not have. Composing leaves rework — deletions and rewrites — uneven rhythm inside words, and thinking pauses at the boundaries of sentences. Retyping someone else's text is steadier and revises little. Each person also carries a fingerprint of habits — spacing before punctuation, runs of marks, where they pause, what they correct and what they keep — that persists across sessions. A correction step may offer fixes, but never imposes them; each accept or keep is recorded, so the record learns which habits are slips and which are style by the author's own choice.

The inversion has a price. Proof-of-work is verified with one hash; proof-of-process must be judged by a scoring standard, and a capable model can synthesize plausible typing. We do not claim any single session is unforgeable. We claim the cost of forging grows with duration, which anchoring forbids compressing; with the number of independent modalities captured — typing, sound, both sides of a camera, agent receipts — which must agree in time; and with recognition by counterparties who are harmed if the record is false.

## 5. Recognition

A certificate is a claim. Claims become merit through recognition by others, in stages:

| Stage | Status |
|---|---|
| A name or skill asserted before any settlement | hypothesis |
| A certified work recognized by an independent counterparty | evidence |
| Repeated recognized settlement | title |
| Recognized settlement archived and retrievable | precedent |
| Precedent reused as authority for a new action | covenant |

Settlement alone is insufficient: a single recognized work is evidence, not standing. Merit is covenant: repeated, recognized, archived and reused. A name follows settlement; it is never assigned before it. Recognitions are themselves signed, anchored records, so the path from hypothesis to covenant is auditable by anyone.

## 6. Forgiveness

Most systems of standing punish error by deletion: the bad review is removed, the transcript is reissued, the history is cleaned. This rewards hiding failures. In this system the book only appends. A correction never deletes; it supersedes, pointing to what it corrects. A slip that is absorbed — corrected, and the work resumed — counts in the person's favor. A slip left uncorrected is part of their signature, never a penalty.

Between peers, forgiveness is a settlement state. A debt, a missed obligation or a failed claim can be recorded as forgiven: written off by the counterparty, without being erased. Forgiveness is then visible, attributable and itself a form of standing, for the one who forgives and the one forgiven. Whether a relationship absorbs a failure or amplifies it is the boundary measure between the two sides of the record.

## 7. Credit

Earlier designs anchor credit to a single authority whose rating is highest, scoring everyone as distance to that anchor. That anchor is a trusted third party. In a peer-to-peer system every person is their own anchor. Credit is not a number the network holds; it is a computation each peer performs on another's book: the probability of settlement, read from settled and falsified records, relative to the reader's own history and requirements. Two peers may compute different credit for the same person, as two lenders may; both can show their work.

Credit gates volume. The amount of trust extended — access, delegation, a credit line, a door opened — rises with confidence and contracts on falsification. A score read only from records, never self-reported, can fall, and a score that never falls carries no information.

## 8. Agents

An agent is a key that acts on a person's behalf. A person signs a delegation naming the agent's key, a scope and an expiry. The agent signs receipts of its work and of the relationship: that it was directed by its principal, that the session stayed within terms, how many errors were recovered without escalation. The principal countersigns the agent's work as accepted or rejected. The three signatures form a triangle anyone can verify.

This makes conduct between people and their agents portable. An agent's record follows its principal across tools; a principal's record of good standing with their agents follows them across platforms. No one's mood is inferred; only signed facts are kept.

## 9. Incentive

A system of merit must not let merit be bought. A record that can be purchased says nothing about the person who holds it. Nothing here sells merit: certificates are free to make, free to anchor and free to inscribe, and a person who chooses to hold their own mark on a chain holds it bound to them, unable to transfer or sell it.

What can be sold is the art. The Book, the sequenced register of inscribed certificates, is drawn from the shape of the work recorded in it and changes with every mark. Collectors can buy it in two forms. Each day the Book as it stands is auctioned as a single page; settling the day mints the page to the winner and opens the next. At each milestone the Book becomes a Portfolio, sold in editions whose price rises with each one collected.

Half of every sale goes to the people whose marks are in it, one equal share per mark, paid by contract to the wallet each author chose, with no one holding the money in between. The rest divides between the platform and a treasury that keeps the system running. The incentive runs one way. The only path to a share is to do the work, have it recognized and inscribe it. Money spent on the art pays the people who made the record; it never buys a place in it.

## 10. Privacy

The traditional model of merit achieves a kind of privacy by limiting access to records to the institutions that hold them. The person described cannot see much of it either. Here, privacy is maintained by never collecting what does not need to exist. Device capture records key types, never characters. Capture runs only in applications the person chooses and pauses wherever the operating system protects a password. Raw logs stay on the device. Certificates carry counts and a Merkle root; each session's events are salted so two sessions cannot be linked by their roots, and any single event can be disclosed with an inclusion proof without revealing the others. Only a hash reaches Bitcoin.

There is a tension the design does not hide. Bitcoin preserves privacy by unlinking transactions from identities. Merit is valuable only because records are linked to one identity over time. The person controls that link: they hold the key, choose which certificates to present, and to whom.

## 11. Simplified Verification

It is possible to verify a certificate without running any part of the system. A verifier needs the certificate, its timestamp proof and public Bitcoin block data: check the signature, recompute the identifier, check the timestamp against the block's Merkle root, and check any disclosed events against the certificate's root. This establishes who signed, that nothing was altered, and the latest time the record could have been made. Like simplified payment verification, it does not establish that the process itself was genuine; that requires a scoring standard applied to the record, and, for higher stakes, the person's longer history and its recognitions.

## 12. Calculations

We consider an attacker trying to present forged merit. They cannot alter another person's certificates without that person's key, and they cannot backdate their own: every anchored record is fixed to its block. They can only fabricate new records going forward, under their own key.

Let a counterparty require a history of duration D, with sessions captured across m independent modalities, recognized by r independent counterparties. To fabricate it the attacker must spend at least D in wall-clock time, since anchoring prevents compressing it. If a fabricated session passes a modality's scoring standard with probability p, and the modalities are judged independently and must agree in time, a session passes all of them with probability at most p^m, and k required sessions pass with probability at most p^(k·m). Each recognition requires deceiving or corrupting a counterparty who bears a cost if the claim is later falsified; corrupting r of them costs at least r times the smallest such stake.

Under these assumptions the attacker's expected cost grows linearly in D and r and the probability of success falls exponentially in k·m. The assumptions are not free: modalities may not be independent against a sufficiently capable generator, and recognizers may collude. These are the two open problems of the design: synthesis of process traces by AI, and collusive recognition. Calibration of scoring standards on real composing and retyping samples, with published error rates, must precede any claim of accuracy.

## 13. Conclusion

We have proposed a system of merit that does not rely on trusted institutions. We started from signed certificates of process, which give strong evidence of who signed what, but are incomplete without a way to stop backdating, a way to make forgery costly and a way to move from claim to standing. To solve this we borrowed Bitcoin's timestamp chain, so no record can be backdated; we inverted proof-of-work into proof-of-process, so the proof is the work itself; and we replaced the credentialing authority with recognition by independent peers, each its own anchor of credit. Corrections append and never delete, so forgiveness is recorded instead of erased. The system needs no currency of its own: its currency is outcomes, and the art made from them pays the people who made them. Its one test is whether a person can carry their book to a stranger and have it open a door, with no institution in between.

## References

1. S. Nakamoto, "Bitcoin: A Peer-to-Peer Electronic Cash System," 2008.
2. S. Haber, W. S. Stornetta, "How to time-stamp a digital document," 1991.
3. N. Szabo, "Bit gold," 2005/2008.
4. W. Dai, "b-money," 1998.
5. V. Buterin, "Ethereum Whitepaper," 2013–2014.
6. P. Todd, OpenTimestamps.
7. K. Benford, "Post-Semanticism," 2025.
8. K. Benford, "Jazz Ascensionism: A 12-Bar Blues," 2025.
9. K. Benford, Paper 050 "The Confidence Score Doctrine" (2026-04-21) and Paper 041 "The Dependency Model" (2026-04-24).
10. Reference implementation: Merit, Apache-2.0.
