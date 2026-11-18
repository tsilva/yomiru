# Yomiru

Yomiru provides Japanese learning subtitle tracks to Stremio. Read `SPECS.md`
before substantive work; use the shared `private-skills_specs-author` skill for
specification changes. Treat its future direction separately from implemented features.

- Keep source text, pronunciation readings and rendered display separate. Original
  Japanese preserves kanji and kana; reading modes must not overwrite the source.
- Keep episode/release identity, script and appearance in generated-track identity.
  Displaying two subtitle timelines does not establish audio synchronization.
- Preserve ASS styling, 4:3/16:9 geometry, escaping and overlap handling.
- Keep downloaded subtitles, generated tracks, provider credentials and personal
  configuration outside tracked source. Examples and tests use original synthetic text.
- Provider integrations must expose missing coverage and uncertain release matching;
  do not reconstruct Japanese dialogue from English translations.
- Keep dependencies locked through uv with the seven-day release cutoff.
- Verify changes with `uv run python -m unittest discover -s tests` and
  `uv run ruff check .`; update the relevant usage guide for behavior changes.

Automatic discovery uses anonymous public sources; do not add credential retrieval
or copy another add-on's private API key. Keep provider requests bounded and cached,
archive handling in memory, and missing coverage explicit. Verify title/season/episode
identity before accepting a candidate. Never label filename heuristics as verified sync.

The optional macOS launch agent belongs to Yomiru. Never replace an existing job
or occupy another service's port. Preserve unrelated pilot services.

Yomiru is a Stremio add-on, with no browser extension dependency. Offer explicit
source-specific merged tracks in Stremio's subtitle picker. Never silently switch
away from a chosen base source when its download fails. The add-on cannot wrap
another add-on's currently selected track or access the player's internal state.

## Hosted release versioning

For each authorized production release of the hosted app or add-on, check the
live manifest at `https://yomiru.tsilva.eu/manifest.json` and the version in
`web/public/manifest.json`. Set a version newer than production while preparing
the release.
Use a patch for fixes, a minor for features or pre-1.0 breaking changes, and a
major for breaking changes once stable. Choose the bump without separate approval.
Include it in the release diff. Keep the manifest URL and add-on ID stable.
Reuse the chosen version when retrying the same release or redeploying the same
build. Subtitle and vocabulary data publications have their own revisions.
Verify the public manifest reports the chosen version after promotion.

## Subtitle generation and audits

Default new administrative subtitle tracks to AgentBridge
`codex/gpt-6.2-sol` at `low` reasoning. Set both explicitly in requests and use
the annotated whole-episode format in the [translation guide](docs/translation-trial.md).
Record explicit overrides for controlled experiments.

Use [yomiru_audit-subtitles](.codex/skills/yomiru_audit-subtitles/SKILL.md) for
requested generated-subtitle audits and semantic regression-case curation.
Keep generation, corrected revisions, evaluation references and publication separate.
