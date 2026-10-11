# Calibration protocol

A scoring standard may not be described as accurate until it has been calibrated here and the report says `claimable: true` (see `GOVERNANCE.md`). This protocol produces the two error rates that matter:

- **False accusation:** a session the person composed that the standard does not call composed. This harms an honest person, so it is the error we bound first.
- **False pass:** a session the person retyped from somewhere else that the standard calls composed. This lets a copy through. It is measured separately for retyped human text and retyped **AI output**, the realistic adversary.

## Minimums
- At least **30 composed** and **30 retyped** sessions that are long enough to score (≥ 50 words; aim for 150+).
- At least **10 participants**. Sessions from one person are correlated, so more people is better than more sessions per person.
- **Proposed admission bar** for a standard to leave "experimental": the 95% upper bound on false accusation ≤ 10%, with false pass reported alongside it, whatever it is. The bar is a proposal until adopted under `GOVERNANCE.md`.

## Each participant (about 30 minutes)
Four sessions, in an order assigned by the coordinator (alternate which comes first between participants):

| # | Label | Task |
|---|---|---|
| 1 | `composed` | Answer a prompt in your own words (list below). |
| 2 | `retyped` | Retype a passage of human writing you did not write (e.g. the Gettysburg Address). Read from a second screen or paper; do not paste. |
| 3 | `composed` | A second prompt. |
| 4 | `ai-retyped` | Ask any AI model for ~200 words on a prompt, then retype its answer by hand. Do not paste. |

Use the same app and keyboard for all four. For each session: start measuring in the Merit menu-bar app, write, then "Stop & sign". Then label it:

```
merit label ~/.merit/sessions/<session>.jsonl composed --participant p07 --task prompt-1
```

**Prompts** (pick any two): a skill you learned slowly and what finally made it click · a decision you would make differently now · explain your work to a twelve-year-old · a place you know well, for someone who will never visit.

## Running the report
```
merit calibrate                      # reads ~/.merit/calibration/manifest.jsonl
merit calibrate pooled.jsonl --threshold 0.5
```
It writes `report.json` and `report.md`: counts, both error rates with Wilson 95% intervals, AUC, the equal error rate and a threshold sweep. Publish the JSON together with the standard version it measured. A new standard version needs a new report; old reports are never edited.

## Consent and privacy
- Adults only (privacy rule 10). Written consent before the first session.
- Participants are pseudonyms (`p01`…); the CLI refuses anything that looks like a name or email.
- What a participant submits is their key-class log: key types and timings, never characters. Every session is linted before it is labeled or scored; a log with any other field is refused.
- Calibration data measures the standard, never the person. It is not used to recognize anyone (privacy rule 1) and is not combined with certificates.
- Participants may withdraw; their rows are removed from the pooled manifest and the report is re-run as a new dated version.

## Known limits (report them with the numbers)
- Lab tasks are not real work. Short prompts understate revision; real documents may score higher.
- Typing skill, language and keyboard layout shift rhythm. Record them per participant (self-reported, coarse) if the pool is diverse enough to split.
- **Dictation and assistive input** do not produce key rhythm. A standard must return `insufficient` for these, never `transcription-like`; no one may be marked down for how they are able to input text.
- A determined forger can practice. This protocol measures casual retyping; adversarial synthesis is an open problem (whitepaper §11).
