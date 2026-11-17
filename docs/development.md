# Development

See the [landing page guide](website.md) for the frontend build and deployment
boundary.

The [published library](publishing.md) adds administrator preparation, a public
read-only Vercel subtitle endpoint and content-addressed ASS assets. `publication`
validates complete translation pairs and renders four display modes.
`web/scripts/upload-library.mjs` validates and uploads a full local snapshot to
Vercel Blob through a protected Production administrator endpoint. It commits
the current-library pointer only after the assets and catalogue are complete.
Website builds reject bundled library files and require no subtitle downloads.
Public GETs perform no inference or provider downloads; unmatched episodes return
an empty subtitle array. Generated library assets remain ignored.
Run `pnpm test:library` in `web/` alongside build and Sites checks for this path.

`web/lib/catalogue.mjs` derives episode coverage from the same published index,
deduplicating display modes. Upload-time metadata is identity-checked and reduced
to public artwork/title fields in the immutable library snapshot.
`web/api/catalogue.mjs` serves catalogue and Yomiru-only metadata resources with
public CORS, bounded search/pagination and explicit release uncertainty. It never
fetches providers at playback time or embeds video streams in episode metadata.
`web/lib/published-library.mjs` refreshes the bucket pointer on each request and
caches only its immutable snapshot. `web/api/library.mjs` retains old website
asset URLs as redirects and exposes the current index for administrator recovery.
Bucket and API caching can delay a new publication by about 90 seconds, plus any
Stremio client caching. Storage failures return an error rather than an empty or
bundled replacement library.

`web/lib/compatibility.mjs` groups video filenames/hashes seen in subtitle requests
by episode, generated source revision and target language, sharing reading-mode
feedback. `web/lib/compatibility-storage.mjs` keeps these records and scoped
anonymous votes in a separate private Blob store through Production OIDC using
`COMPATIBILITY_STORE_ID`. The public subtitle store continues using `BLOB_STORE_ID`.
Private reads bypass the CDN and conditional writes retry bounded concurrency
conflicts; normal storage/authentication failures are not retried by the adapter.
Subtitle discovery waits at most 1.5 seconds for optional observations/results;
slower work uses Vercel's invocation lifetime through `waitUntil`, with a 15-second
overall observation deadline and at most four concurrent source updates.
Observation failures do not block subtitle serving. Same-source repeat requests
are coalesced within a UTC day; timestamps do not count viewers or plays.

`web/api/compatibility.mjs` serves public source details and vote totals without
exposing voter identities. POST accepts binary votes from the same-origin feedback
page, with one replaceable vote per anonymous browser token and source/revision.
Only a scoped digest is persisted, not the browser token, IP address, Stremio
account or full local path. These are anonymous reports, not abuse-resistant
verified-user ratings. Source records are capped at 500 per revision, votes at
5,000 per source and serialized revision state at 1 MiB. Catalogues link to the
separate `/compatibility` page; the minimal landing page remains unchanged.

Public Stremio add-on GET resources use credential-free cross-origin responses
for desktop and Web clients. The separate caption-composition API restricts
browser origins; its POST permission is not inherited from public resource access.

```sh
uv sync --locked
uv run python -m unittest discover -s tests
uv run ruff check .
```

The lockfile pins dependencies; `[tool.uv] exclude-newer = "7 days"` keeps new
resolutions behind a release-age cutoff. Source dependencies come from the
standard package registry. Generated libraries, environments and private QA
records are ignored. Test fixtures contain original synthetic dialogue.

See [branding assets](branding.md) for the logo, icon, preview and export records.

## Flow

`captions` parses input and combines simultaneous cues. `japanese` separates
source spelling from pronunciation. `render` assigns distinct ASS styles and
wraps text for the video canvas. `library` stores content-addressed assets.
`server` exposes the Stremio manifest, subtitle resource and fixed asset route.
`cli` connects manual builds, automatic discovery and serving.

`timing` fits a bounded constant onset offset for discovered pairs, with minimum
coverage, ambiguity and timeline-consistency checks. It keeps the base timeline,
skips weak fits and records adjustments in provenance and the ASS header. A
reliable fit also permits mutually unique cue pairs with start/end differences
of at most 250 ms to share the base boundaries. Dense, split or ambiguous pairs
remain unchanged. Manual
caption builds retain source timing by default. Independent manual delays are
validated and included in identity; source files remain unchanged. This is not
an audio alignment implementation.

The product is a standard Stremio subtitle add-on. Each selectable entry fixes
one base source, one Japanese source and a display mode. Keep those sources in
the cache identity and never replace a failed chosen source silently. The add-on
does not inspect the player's state or depend on a browser extension.

`compose` also accepts supplied caption documents through a bounded local JSON
API; `jobs` supports short polling for clients with request deadlines. No source
URLs are accepted by that API.

`providers` resolves IMDb/Kitsu/AniList/MAL identities, checks aliases, queries
Kitsunekko directories and ZIP members, and uses OpenSubtitles' Stremio protocol.
`discovery` combines the results and generates a selected track lazily.

`coverage` rejects extremely sparse automatic base sources using both unique cue
counts and union duration. Listing checks fresh cached documents, with no extra
source downloads; generation checks previously unseen pairs and never substitutes
another source. Manual caption composition is unaffected by this filter.
Request identity includes episode, filename/hash extras, source candidates, script and
appearance, timing settings and fitting version. Automatic tracks are excluded
from the unfiltered manual library list.
`network` restricts anonymous HTTPS requests/redirects to the supported sources,
caps responses, bounds retries and stores a size-limited persistent SQLite cache.
`service` manages only Yomiru's optional macOS launch agent, using the selected
checkout/environment and refusing existing configurations or occupied ports.

Tests use synthetic HTTP responses and original captions. They cover the complete
subtitle-list → selected asset flow, incorrect seasons/episodes, source failures,
ZIP limits, blocked redirect destinations, cache identity and reuse after restart.

## Next integrations

Providers must return episode-specific candidates with provenance and explicit
release evidence. Current calls are anonymous; no account provisioning or
credentials are wired in. Respect upstream rate limits and usage requirements.

Candidate areas to investigate:

- Authenticated Japanese providers where an operator has an approved access route.
- Stronger release matching, edition selection and supported audio alignment.
- Verified TV-season/absolute episode mappings and broader archive formats.
- Per-show pronunciation overrides, with explicit persistence and tests.
- A user-facing configuration flow and managed-service display preferences.
- Access from other Stremio devices, with an explicit hosting decision.

Keep these proposals distinct from completed features. Do not import one show's
specific names, timings, release IDs or manual corrections into the general code.

## Protocol references

- [Subtitle request parameters](https://stremio.github.io/stremio-addon-sdk/api/requests/defineSubtitlesHandler.html)
- [Subtitle response and ASS support](https://stremio.github.io/stremio-addon-sdk/api/responses/subtitles.html)
- [Cutlet conversion API](https://polm.github.io/cutlet/)
- [Kitsunekko Japanese directory](https://kitsunekko.net/dirlist.php?dir=subtitles%2Fjapanese%2F)
- [OpenSubtitles v3 add-on](https://opensubtitles-v3.strem.io/)
- [AniList GraphQL requests](https://docs.anilist.co/guide/graphql/)

Stremio supplies an episode ID and may supply filename/hash information.
Ordinary subtitle requests do not give this service the player's audio or all
embedded captions. Automatic listening verification needs a separate supported
media-access integration; it must not be inferred from text alignment.
