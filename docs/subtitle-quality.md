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
