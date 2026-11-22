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

Use [yomiru_build-release](.codex/skills/yomiru_build-release/SKILL.md) to build,
publish, and verify hosted app and staged library releases.

For each authorized production release of the hosted app or add-on, check the
live manifest at `https://yomiru.tsilva.eu/manifest.json` and the version in
`web/public/manifest.json`. Set a version newer than production while preparing
the release.
Use a patch for fixes, a minor for features or pre-1.0 breaking changes, and a
major for breaking changes once stable. Choose the bump without separate approval.
Include it in the release diff. Keep the manifest URL and add-on ID stable.
Reuse the chosen version when retrying the same release or redeploying the same
build. Verify the public manifest reports the chosen version after promotion.

For subtitle-only releases, use `vercel-library-production` to update the
library listing, subtitle assets, and associated vocabulary under a new library
revision. Reserve app and add-on deployments and manifest version bumps for
authorized app releases. Verify the live library listing and Stremio subtitle
discovery after activation.

An explicit owner request to push live includes pending app changes and the
validated library package in `.local/release/pending-library.json`, unless
the request narrows the scope. Dispatch GitHub Actions **Production delivery**
with the exact approved `main` SHA in `release_sha` only after an explicit
push-live request. Ordinary pushes sync configuration after CI. Use the approved
`vercel-library-production` Runbox profile for subtitle packages. If both are
pending, release and verify the app first, then publish and verify the library.
Follow the Yomiru exception to draft approval and the existing credential policy.

## Subtitle generation and audits

When the owner asks to add an episode or movie, first provide a numbered plan
for that release and name the skills that will be used. For a new Grand Blue
episode, show the plan in chat before starting episode work. Make it specific
to the requested episode and cover how you will confirm the source and timing,
prepare both subtitle variants and artwork, review Practice and Verb Trainer,
and stage, publish, and verify the release as authorized.

Use [yomiru_manage-episodes](.codex/skills/yomiru_manage-episodes/SKILL.md) for
episode and movie additions and maintenance. New titles default to Kana + English
and Rōmaji + English tracks from the same paired translation, with original
artwork. Other unspecified subtitle requests default to one English + rōmaji
track. Honor the requested language and reading mode.
For a bilingual episode release, use `web/scripts/release-episode.mjs` with the
approved corpus and library executors. Prepare and complete the
[episode release review](docs/subtitle-quality.md#episode-release-review)
before activation. Render the ASS from database cues and replay the full
reviewed English exercise before activation and from production afterward.

Generate new administrative subtitle tracks with `uv run --extra translation
yomiru translate`. The CLI defaults to AgentBridge `codex/gpt-6.2-sol` at `low`
reasoning and one worker. Use one chunk whenever it fits the safe token budget,
and let the CLI split larger outputs. Keep the full annotated Japanese script
ahead of the target IDs. See the [translation guide](docs/translation-trial.md)
and record explicit overrides for controlled experiments.

Use [yomiru_audit-subtitles](.codex/skills/yomiru_audit-subtitles/SKILL.md) for
requested generated-subtitle audits and semantic regression-case curation.
Keep generation, corrected revisions, evaluation references and publication separate.
