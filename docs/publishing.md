# Published subtitle library

The hosted add-on serves complete administrator-published tracks. Viewers install
`https://yomiru.tsilva.eu/manifest.json` and select Yomiru in Stremio's subtitle
picker. No local server or inference account is required. Each track identifies
its Japanese source and marks video timing as unverified.

## Prepare an episode

Generate complete Japanese-anchor translation pairs using the
[translation pipeline](translation-trial.md). Keep original Japanese, readings
and translated meaning separate. Inspect semantic and cue-scope quality before
publication; structural validation does not certify meaning or audio sync.
The administrator may use a locally configured Codex/AgentBridge account route.
Account capacity still applies; public requests never trigger inference.

From the repository root:

```sh
uv run yomiru publish \
  --pairs /path/to/complete/pairs.json \
  --video-id tt1234567:1:1 \
  --source-label 'Japanese source · episode 01' \
  --source-url https://example.org/subtitle-source
```

This produces all four display modes in the ignored `.local/published/` library.
Repeat `--video-id` only for independently verified aliases of the same episode.
Use `--type movie` for movies and `--language` for another three-letter target
language. The command requires a complete validation record and retains source
cue times. It does not upload anything.

For European Portuguese, use `--language por` and identify **Português (Portugal)**
in the source label. Translate directly from the same annotated Japanese anchor;
do not use the English translation as the Portuguese source. Adding a target
language preserves existing English tracks, Japanese anchor identity and episode
vocabulary. The four reading modes are available for each target language;
Portuguese subtitle coverage does not imply Portuguese dictionary meanings.

The public index contains IDs, content hashes, source attribution, language,
display mode and timing limitations. Original downloads, prompts, credentials,
account details, local paths and private reports are not exported. Subtitle
assets are immutable and addressed by their SHA-256 content hash.
Spacing-only revisions preserve dialogue, cue times, geometry and source identity.
Regenerate assets for every reading mode, publish a new complete snapshot, and
retain the previous immutable assets; never overwrite files at their old URLs.

Publication also derives Japanese vocabulary from the shared episode anchor.
Supply `--dictionary /path/to/JMdict_e.gz` (or a JMdict Simplified English
`.json.tgz`) to include English dictionary meanings. Adding another translation
reuses the same word set and IDs; a different Japanese source is rejected rather
than silently changing vocabulary. Existing published generations can be enriched
without regenerating subtitles. See [vocabulary exports](vocabulary.md).
Meanings live once in the versioned master registry; episode assets contain word
references and occurrence context. Keep the registry descriptor and its asset
with the complete local library. Ordinary episode uploads preserve published
resolved meanings; intentional master-meaning updates use `--update-registry`.

The Stremio catalogue is rebuilt from this index on publication. Four display
modes count as one available episode. Series require a verified IMDb episode ID
(or verified IMDb alias) for catalogue inclusion. Upload-time Cinemeta metadata
provides descriptive series and episode metadata, including artwork, titles,
synopses, dates, cast, genres, ratings, runtime, credits, external IDs, trailers and
original navigation links. It cannot add episodes absent from the subtitle library.
Identity mismatches or unavailable metadata fail publication.
Every publication fetches the original metadata for all covered shows and uses
the same mapping for existing and newly added shows and episodes. No per-title
code change or website deployment is needed. A covered episode missing matching
source metadata or a title stops publication before upload; optional missing
synopses remain empty.
The catalogue uses separate `yomiru:` show pages and standard episode IDs, so
existing video providers remain usable. It does not replace ordinary Cinemeta
pages; adding its show page to a library may create a separate entry.
Series titles, synopses, episode names and episode descriptions preserve the original
metadata without Yomiru prefixes, episode counts or subtitle-status text. Original
descriptive metadata is retained in both catalogue previews and series details;
episode metadata is retained for the published episodes. Source-provided playback
transports are excluded so Stremio still requests streams from the viewer's add-ons;
default episode hints cannot point outside published coverage. Missing
episode synopses remain empty. Subtitle entries and feedback pages retain source
attribution and release timing uncertainty. Republish the library to refresh saved
catalogue metadata after changing which source fields are preserved.

## Upload and serve

Subtitles live in the public Vercel Blob store `yomiru-subtitles-production`,
separate from the website. Prepare episodes locally, then upload the complete
library using an administrator's existing Vercel CLI login:

```sh
node web/scripts/upload-library.mjs --dry-run
node web/scripts/upload-library.mjs
```

Run these commands from the repository root after `uv run yomiru publish`.
`--library-dir /path/to/library` selects a different complete local library.
The dry run validates assets and prepares catalogue metadata without uploading.
Individual assets and the combined index/catalogue snapshot must each fit the
3 MiB administrator upload limit.
The upload command discovers the existing Yomiru Production deployment, checks
its project identity and deployment protection, then uses `vercel curl` to call
its protected `/api/admin-publish` endpoint. No website build or deployment is
needed for new episodes. Missing CLI authorization stops the upload; sign in
through Vercel's normal trusted flow rather than supplying keys to Yomiru.

The store is connected only to Production using Vercel OIDC. No Blob write token
or inference key belongs in local files or the public add-on. Keep Vercel
Authentication enabled for all deployment URLs, excluding custom domains.
The upload API accepts only the exact protected Production deployment hostname;
the public custom domain returns 404. `--deployment HOSTNAME` targets a reviewed
staged Production deployment during code rollouts. Do not disable deployment
protection: it is the upload endpoint's authentication boundary.

Uploads first verify immutable `/library/HASH.ass` assets and a content-addressed
snapshot containing the index and catalogue. They then update
`/library/current.json` conditionally using its ETag. Incomplete uploads and
concurrent publishers cannot commit a partial library. Existing episode/source/
display coverage must remain present; superseded immutable files are retained.
Re-running the command safely reuses existing identical objects. A rejected
publication leaves the previous pointer intact; inspect the reported failure
before running it again. Newly uploaded files may briefly need time to become
publicly readable; verification waits for a bounded period before stopping.

Serving functions refresh the pointer on every request and reuse immutable
snapshots. Bucket and API caching can delay an update by about 90 seconds;
Stremio may retain its own cache longer. Catalogue coverage updates with the
same snapshot as subtitle discovery. Public requests never trigger generation
or allow subtitle uploads. Optional source observations and explicit viewer votes
are stored separately from the published library. Existing website asset URLs
redirect to the bucket.

Website builds require no library downloads and reject bundled subtitle files.
Keep a separate backup of `.local/published/` and original generation inputs.
To restore an administrator library, download `/library/index.json` and every
referenced content-addressed asset into `.local/published/`, preserving the full
index. Run the dry check before adding episodes. Website deployment and Git
delivery are separate from library publication.

## Source observations and feedback

The private `yomiru-compatibility-production` Blob store holds source observations
and anonymous votes; it is connected to Production through OIDC with the
`COMPATIBILITY` prefix. Preserve this separate connection and the public subtitle
store's `BLOB` prefix. No static token or local credential file is needed.
Source-specific short links retain immutable episode, subtitle revision and
source context in `feedback-links/v1/` in the private store, so an old QR code
cannot vote on a newer revision. Selecting a track deterministically composes a
three-second ASS card from the published original; no translation or inference
runs during playback. The composed ASS is cached immutably in the public store
under `feedback-tracks/v1/`, shared by subsequent viewers. Its identity includes
the base track, short-link context and card version. A missing/corrupt asset or
failed composition returns an error rather than substituting another source.
Original dialogue events and timings remain intact. Early dialogue moves the
card to the top; otherwise it appears at the bottom left.

Only sanitized video basenames, optional OpenSubtitles hashes/file sizes, seen
timestamps and scoped anonymous votes are retained. The public API exposes source
metadata and aggregated Works/Doesn’t work counts, never stored voter digests.
No identity is inferred when Stremio omits both filename and hash.

Publishing a changed subtitle revision starts a fresh feedback group. Existing
private records are retained, with no automatic carry-over of votes or fabricated
confirmation. [Viewer instructions](usage.md) explain the source list, unrated
filter, pooled percentages and limits of anonymous browser voting.

## Verify and migrate

Check these public endpoints after uploading:

- `/manifest.json`: Stremio manifest, public CORS, no local URLs.
- `/catalog/series/available.json`: shows with published episodes; search and
  pagination use standard Stremio extras.
- `/meta/series/yomiru:IMDB_ID.json`: original descriptive series/episode metadata,
  with Yomiru's series namespace and published episodes' standard playback IDs.
- `/subtitles/series/VIDEO_ID.json`: exact episode's four display variants.
- `/subtitles/series/VIDEO_ID/filename=RELEASE.json`: episode resource when
  Stremio supplies filename/hash extras. Source labels do not prove release sync.
- Each returned HTTPS `.ass` URL: correct hash, ASS header and styled cues.
- An unpublished episode: successful response with an empty subtitle array.

Install the hosted add-on and verify the picker/download path on each episode.
Remove old local Yomiru/pilot installations only after this works. Retain
generation inputs and evidence; retire active local copies and Yomiru's
background service separately from unrelated services.
