---
name: yomiru_audit-subtitles
description: Audit generated English subtitles and contextual Practice questions against Japanese, save supported corrections, and curate semantic regression cases. Use for subtitle or Practice content reviews.
---

# Audit subtitles

Work in this skill’s owning Yomiru checkout. Read [SPECS.md](../../../SPECS.md)
and the [quality workflow](../../../docs/subtitle-quality.md). Locate the selected source,
original generation and exact generation configuration before judging quality.
Keep downloaded captions, references, corrected files and reviews in ignored
private storage; public examples must be synthetic.

## Review and correct

- Preserve original output and source IDs/times. Save corrections as a new hashed
  revision with the original as parent; never overwrite the raw generation.
- Review each English meaning unit against its own Japanese and enough surrounding
  Japanese to resolve references, idioms and technical context. Retain source
  furigana and speaker evidence. Use available visual/audio evidence for a disputed
  delivery-dependent interpretation; otherwise keep it uncertain.
- Accept fully accurate paraphrases, grammatical voice changes and context-supported
  omitted-subject resolutions. References are examples, not a closed whitelist.
  Reject a change motivated only by wording preference or remembered dub dialogue.
- Separate confirmed meaning/cue-scope errors, minor precision, valid alternatives,
  optional polish and unresolved interpretations. Adjudicate proposed errors against
  the source before making a correction; the audit model can also be wrong.
- For a supported correction, retain the affected IDs, exact source evidence,
  original/generated English, corrected English, rationale, severity and provenance.
  Retain unresolved findings in a review queue without making them hard-failure gold.

## Review scored Practice occurrences

Use the [episode review packet](../../../docs/subtitle-quality.md#episode-release-review).
Inspect the compiled exercise in source order. Put each exact Japanese
highlight, displayed kana and rōmaji slices, all answer choices, and the
credited ID with its headword, reading, part of speech, and senses in one row.
Read the cue and its neighbors when resolving context. Include repeated
occurrences and inspect exclusions for missed vocabulary.

- Check that the answer translates the highlighted characters. Include the
  particles, negation, or auxiliaries that supply the answer's meaning.
- Compare same-spelling and same-reading entries across the episode. Check the
  credited entry's sense and part of speech even when the English answer fits.
- Compare the compiled reading with source furigana and the credited entry.
  Check names, counters, ordinals, colloquial contractions, and leading or
  trailing punctuation inside the rendered highlights.
- Read every alternative as a potential translation in context. Remove
  equivalent paraphrases and options that give the answer away through
  grammar, tense, or format.

After each revision, regenerate the rows and check other occurrences of every
failure pattern, including exclusions. Repeat the source-based pass until it
finds no further supported edits. Replay the final questions for ordering and
scoring so the language decisions and their execution are both verified.

## Curate regression evidence

- Promote confirmed failure patterns into cases with Japanese context/annotations,
  target IDs, source revision, semantic requirements and optional reviewed English
  variants. Keep original and corrected revisions reconstructable.
- Do not copy English references or semantic assertions into generator inputs.
  A new, fully accurate translation must pass even when it matches no reference.
- Deduplicate patterns into a small hard-case core and rotating sample; archive all
  audit findings separately. Keep untouched shows/episodes for final confirmation.
- Compare new candidates with the accepted baseline using structural checks,
  blinded semantic assessment and repeats for finalists. Keep known baseline failures
  visible; report new confirmed regressions separately from improvements and noise.
- Reuse semantic assessments only for identical source/context, English and rubric.
  Review novel wording; adjudicate disputed flags instead of declaring all differences
  regressions. Record per-case variability and observed non-regression, not perfect
  population accuracy.

Report corrected revisions, supported findings, valid variants, unresolved issues,
curated cases and any measured time/token use. Generation stays a separate single
model/pass operation. Auditing does not authorize publishing tracks, changing
providers/access settings or promoting a failing pipeline without a recorded
selection decision.
