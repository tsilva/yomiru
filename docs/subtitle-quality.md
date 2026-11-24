# Subtitle quality workflow

This is the intended audit and regression workflow. The [subtitle-audit skill](../.codex/skills/yomiru_audit-subtitles/SKILL.md) is
available for agentic audits and case curation. Automated corpus/promotion tooling
remains planned.

The accepted generation pilot uses one model and one whole-source pass, with
annotated Japanese input and one `id|English` output line per cue. Code preserves
source identity and timing. Auditing is a separate operation, so generating every
episode does not require a second model pass.

## Generate, audit, learn

1. Preserve the original generation, source captions, annotations and configuration
   identity. Keep model output immutable; a correction produces a new revision.
2. Audit English against its own Japanese cue and the surrounding Japanese script.
   Context can resolve omitted subjects and idioms. Preserve meaning in its cue.
   Distinguish a confirmed error, a fully valid alternative, a style preference and
   an interpretation that needs more evidence.
   The [AgentBridge subtitle review](translation-trial.md#agentbridge-subtitle-review)
   can collect private proposals for English episodes during the audit. Check
   proposed changes, unresolved cues, and implicit keeps against the Japanese
   before recording release decisions.
3. Correct only supported errors. Retain evidence, rationale, severity, affected
   IDs and parent/output hashes. Quarantine unresolved findings rather than
   promoting a questionable correction as truth. Source text alone does not
   certify audio synchronization or resolve every speaker/action ambiguity.
4. Convert confirmed error patterns into semantic regression cases. Retain the
   relevant Japanese context, annotations and original cue ownership. Reviewed
   English examples and semantic assertions are evaluation-only.
5. Compare pipeline candidates against the accepted baseline. Use cheap diagnostic
   cases to shortlist, then confirm finalists with whole-source output and fresh
   held-out material. Promote changes after the declared regression checks pass.

Keep publication separate from auditing and benchmark promotion. A corrected
private revision does not itself authorize replacing a hosted subtitle asset.

## Episode release review

Use the [corpus-backed release command](publishing.md#incremental-episode-upload)
to generate the private review packet. It contains the original annotated
Japanese, paired translation, resolved vocabulary, and an English Practice
preview with the source coverage ledger. The initial decisions are pending.

`review-packet.jsonl` puts each Japanese cue, its annotations, paired text,
rendered readings, scored highlights, alternatives, credited entries, gloss
spans, and coverage in one row. After editing `review.json`, use the same
`release-episode.mjs` inputs with `--review-packet PATH` in place of `--dry-run`
to compile the current review. Add `--baseline-packet PATH` pointing to a full
packet from the same episode to get the changed cues, surrounding cues, repeats,
and related excluded spans. Focused packets support language review; complete
cue decisions and full exercise replay are still required for release.

For English, `practice-matches.json` lists candidates in source order. At
each start, it shows the longest complete matches first. Candidates can
come from the glossary, an inflected predicate, or a saved review. The
`preferred` list uses aligned readings and an unambiguous English gloss
found in the paired line. Other candidates preserve possible meanings and
shorter spans. Review the surrounding dialogue to resolve paraphrases,
homographs, and competing meanings. Terms inside a detected inflection
remain visible as candidates.

The `wholeExpressions` list marks verified fixed expressions and
meaning-changing endings, including supported spelling and inflection
variants. Prefer the full contextual match. If the packet supplies a
`suggestedWord`, confirm it against the pinned dictionary and add it and
the chosen gloss to the supplemental vocabulary when needed. Use the
full target span and bind its component tokens with `practice.segments`.
For a literal or otherwise independent use of a recognized spelling,
record the exact `start`, `end`, `form` and contextual `reason` in
`practice.expressionExceptions[CUE_ID]`.

Use `masteryConflicts` to compare IDs with matching readings and lexical
senses. Resolve confirmed duplicates in the target and segment IDs.
Release validation catches clipped or miscredited known expressions
and duplicate credit with matching lexical evidence. Distinct readings
and meanings still require separate contextual review.

For group pronouns, `groupPronouns` lists the full source spans and candidate
vocabulary IDs. Resolve any missing full entry from the pinned dictionary
and add it as reviewed supplemental vocabulary when needed. Use one
`practice.targets` row for the whole form, such as 俺たち or お前ら, with its
contextual meaning and full entry ID. Use `practice.segments` to link the
whole span to that ID when the archive tokenizes the ending separately.
Release validation rejects a clipped or missing group pronoun, a missing
rōmaji ending, a mismatched headword or reading, and a clearly singular answer.

A matching saved cue can prefill its exact targets, choices, reading edits
and coverage decisions in `review.json`. Prefill requires matching
Japanese, tokens, paired English, neighboring cues, readings, and the
relevant vocabulary entries. Conflicting reuse stays a suggestion. Read
the compiled preview and confirm the decisions for this episode.

1. Compare each translation with its own Japanese and neighboring cues. Keep
   negation, modality, participants and sentence fragments within their cue.
   Record `accepted` in `cues[CUE_ID].translation` once it reads correctly.
   Record `caption-ambiguity` with a short `note` when the captions support
   the paired meaning but leave a nuance open. Correct confirmed mistakes in
   a new paired revision, then generate a packet for that revision.
2. For English, fill `practice.targets` with cue IDs, source code-point
   `start` and `end`, exact `form`, credited `wordId`, and `choices` with the
   answer first. Review skipped and excluded spans as well as targets. Give
   independently meaningful particles a question with four reviewed English
   choices. Use a plain-English description of the particle's function when it
   has no direct English equivalent. Keep a whole idiom or inflected form where
   the answer depends on it. Check consecutive and repeated occurrences together.
3. Check the shown kana and rōmaji, including boundaries and short interjections.
   Verify each answer against the exact highlighted span and the neighboring
   cues. Keep adjacent punctuation in the line outside the highlight. Check
   plausible alternatives in the same form and discard options that would also
   fit. Confirm the vocabulary ID against the spelling and contextual sense.
   When a tokenizer ID combines separate dictionary entries, use the entry
   that supplies the tested sense. Use verified `practice.readings` or
   `practice.segments` corrections
   and `practice.exclusions` for explicit dispositions when needed. A cue
   without a question still needs its coverage checked. For a sound-only
   caption direction with no spoken tokens, use a whole-cue `-sound` exclusion.
   In a cue with a compound and another question, check that the peek covers the full
   compound in kana and rōmaji and shows its gloss while the other word is
   tested. When a reviewed compound spans separate entries, record its cue,
   source offsets, spelling, kana reading, JMdict entry ID and contextual
   gloss in `practice.peeks[CUE_ID]` as `start`, `end`, `form`, `reading`,
   `jmdictEntryId` and `gloss`. Use hiragana for the reading. Then test a
   question inside the compound. Hide any peek that would reveal the answer
   and confirm the remaining component peeks still work. Mark
   `cues[CUE_ID].practice` as `accepted` once these checks pass. For Portuguese,
   leave Practice as `not-applicable`.
   To apply reviewed readings to the downloadable kana and rōmaji tracks, list
   the cue IDs in `practice.subtitleReadingCues` and render the staged ASS with
   those edits. The dry run checks both rendered files, and publication checks the
   same bytes against the stored cues. The original Japanese and its timing
   remain in the source archive. If source furigana changes the reading of
   a cue, include its reading in the review alongside the correction so the
   renderer can verify that every difference is accounted for. If furigana
   gives only the end of a contiguous span, such as a given name, review the
   whole written span and include the annotated reading at the end.
4. Recheck the episode after fixing any finding. Search both questions and
   excluded spans for other occurrences of the same failure. When a pass
   finds no further supported edits, validate the completed review with
   `--dry-run --review`. Validation binds the decisions and prepared exercise
   to the exact episode, source, paired translation and vocabulary, rejects
   incomplete coverage or direct distractor alias collisions, and replays
   each question and its credit. The dry run and live replay also check
   that scored spans matching a single dictionary word have their full
   peek offsets. The live replay also checks the exact spans and glosses
   of separately reviewed peeks. The source-based review makes the language judgments.

Keep the packet and completed review in private storage. Preserve the
release review ID with the release evidence so retries use the same
reviewed input.

## Subtitle provenance

Update the private subtitle provenance registry when adding a source or revision.
Record the episode ID, source edition or file, provider or link where known, and
content hashes or links to the existing receipts. Identify which source supplies
the dialogue and timing, how the English was produced, and which references were
used to review and refine that specific revision. Mark uncertain attribution or
release matches explicitly.

Describe a generated track as a Yomiru learning track derived from the Japanese
caption source. Credit outside English editions as review references when they
helped refine that revision. For a track composed from an existing English
subtitle, identify that subtitle as an input. Track hosted status separately so
local corrections can be attributed to the correct revision.

## Semantic equivalence

Reference English illustrates meaning; it is not the only accepted wording.
For example, `ここで少し待って。` can be faithfully rendered as both
“Wait here a moment.” and “Please wait here for a little while.” A new wording
must remain eligible even when it matches none of the reference examples.

Assess participants, actions, negation, modality, uncertainty, roles, terminology,
idioms, important modifiers and cue ownership. Different English that preserves
those properties passes. A fluent whole utterance can still move meaning into an
earlier cue, so cue-local alignment remains a separate criterion. String equality,
edit distance and similarity scores are not semantic accuracy metrics.

Structural checks remain exact: every expected ID once, required order, complete
nonempty text and unchanged source timing. These checks do not establish meaning.

## Nondeterministic generation and review

A single differing output is not proof of a regression. Review the Japanese and
context first. Audit reviewers can also make mistakes; adjudicate flags and keep
uncertainty visible rather than failing every disputed interpretation.

Repeat finalist runs under the same frozen source/configuration and compare
confirmed errors, affected cases and severity across runs. Report per-case pass
counts, new versus existing failures, and timing medians/ranges. Describe an
observed non-regression result without promising that every future generation
will be identical or error-free. Different correct paraphrases are successes.

The accepted baseline can contain documented known failures. Keep those failures
visible as improvement targets; do not change the reference to bless them or
hide them as passes. Surface new confirmed regressions separately from improvements
elsewhere. A deliberate quality/efficiency tradeoff must be recorded as an explicit
selection decision rather than silently relaxing the suite.

Reuse an earlier semantic assessment only when source/context, candidate English
and rubric identity match. Review novel wording semantically. Preserve the judge,
rubric and adjudication versions so a changed reviewer does not silently change
benchmark history.

## A small, growing suite

Store source-containing records, generated/corrected revisions and reviews in
ignored private storage. Track only reusable tooling, schemas and synthetic
fixtures in Git.

A case should identify:

- Source revision, Japanese target IDs and enough Japanese context/annotations.
- Required meaning and cue ownership, with forbidden unsupported meaning where clear.
- Optional reviewed English examples, issue category, severity and evidence.
- Audit/adjudication provenance, uncertainty and case revision.

Deduplicate recurring error patterns. Maintain a small core of informative hard
cases and a rotating broader sample; adding every easy cue would increase cost
and dilute the meaning of the result. Preserve the complete audit history outside
the active suite. Hold back new shows/episodes for final confirmation; material
used to tune prompts is development data thereafter.

More reviewed material expands coverage and provides evidence for better choices.
It does not automatically improve a model: prompt/model changes must still be
proposed, measured and checked against the regression cases.

## Efficiency and reporting

Reuse successful generation artifacts by exact source/annotation, glossary,
prompt, model/reasoning and format identity. Run deterministic checks before model
review. Batch novel semantic reviews and reserve full-source generations and
repeats for finalists. English references and assertions never enter generation.

Report input/output usage, available reasoning/cache counters, full request time,
valid-response rate and observed semantic outcomes. Actual cost or dated rate
estimates are separate from token counts; missing account-backed cost is unknown,
not zero. Screening tasks and full-source production measurements remain distinct.
