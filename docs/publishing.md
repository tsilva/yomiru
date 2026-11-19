# Published subtitle library

The hosted add-on serves complete administrator-published tracks. Viewers install
`https://yomiru.tsilva.eu/manifest.json` and select Yomiru in Stremio's subtitle
picker. No local server or inference account is required. Each track identifies
its Japanese source and marks video timing as unverified.

## Prepare an episode

Generate complete Japanese-anchor translation pairs using
[`yomiru translate`](translation-trial.md#administrative-generation). Keep original Japanese, readings
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

Supply `--japanese-source /path/to/original.srt --archive-dir .local/source-archive`
to preserve the original Japanese file and a compressed, versioned analysis of
every cue and token position. The source must match the translation pairs.
The archive uses content hashes so another translation can reuse it. Positions
are Unicode code point ranges in the cleaned cue text, and cue times are in
milliseconds. Keep this directory private and separate from the public library.

For European Portuguese, use `--language por` and identify **Português (Portugal)**
in the source label. Translate directly from the same annotated Japanese anchor;
do not use the English translation as the Portuguese source. Adding a target
language preserves existing English tracks, Japanese anchor identity and episode
vocabulary. The four reading modes are available for each target language.
Vocabulary study and export use English meanings for every episode.

The public index contains IDs, content hashes, source attribution, language,
display mode and timing limitations. Original downloads, prompts, credentials,
account details, local paths and private reports are not exported. Subtitle
assets are immutable and addressed by their SHA-256 content hash.
Spacing-only revisions preserve dialogue, cue times, geometry and source identity.
Regenerate assets for every reading mode, publish a new complete snapshot, and
retain the previous immutable assets; never overwrite files at their old URLs.

`yomiru publish` derives missing Japanese vocabulary from the source cues before
saving the new subtitle tracks to the local library. Each new or revised track
ships with matching vocabulary for its video IDs, including verified aliases.
Existing vocabulary coverage is retained.
Supply `--dictionary /path/to/JMdict_e.gz` (or a JMdict Simplified English
`.json.tgz`) to include English dictionary meanings. Adding another translation
reuses the same word set and IDs. A different Japanese source requires an explicit
source migration. Existing published generations can be enriched without
regenerating subtitles. See [vocabulary exports](vocabulary.md).

Meanings live once in the versioned master registry; episode assets contain word
references and occurrence context. Keep the registry descriptor and its asset
with the complete local library. Ordinary episode uploads preserve published
resolved meanings; intentional master-meaning updates use `--update-registry`.

The website's subtitle library derives its coverage from this index. Four display
modes count as one available episode. Series require a verified IMDb episode ID
or alias. The publisher fetches Cinemeta metadata on first use and caches verified
movie and series entries by type and Stremio ID. It preserves titles, synopses,
artwork, dates, cast, genres, ratings, runtime, credits, external IDs, trailers and
navigation links. It refreshes a series when the cache lacks a required episode
or title. Publication requires matching metadata and titles for every covered
episode. Optional synopses may be empty.

Verified entries are stored in `.local/cinemeta/` with the source URL, fetch time
and metadata checksum. The same cache serves staging and dry runs across library
directories. Use `--cinemeta-cache-dir PATH` to select a different cache or
`--refresh-cinemeta` to fetch fresh metadata for the covered titles. A failed
refresh preserves the last verified entry.

For movies, publish against the standard IMDb movie ID, without a season or
episode suffix. The website lists covered movies with verified Cinemeta titles
and direct Stremio movie links. The viewer's stream add-ons supply video.
Name the source cut in the track attribution when several cuts share a movie
ID. Published track metadata retains release timing uncertainty.
The Stremio picker lists an unanchored legacy track when that episode, translation
language and reading mode has no anchored replacement. Set `superseded: true` on
a previous revision to hide it from the picker while preserving existing track
URLs and feedback. Publish its replacement in the same library revision.

## Upload and serve

Published subtitles are stored separately from the Vercel website. Prepare
episodes locally. To stage a complete library for a production release:

```sh
mkdir -p .local/release
node web/scripts/upload-library.mjs --stage-out .local/release/pending-library.json
```

Staging checks new and revised tracks for matching vocabulary before packaging
anything for upload. If the check fails, run `yomiru publish` with the original
translation pairs for the affected title. Staging records the active Neon
revision and the new content-addressed objects. It retains previous track
revisions for saved links and refuses to overwrite a pending package.
The release operator uses the approved publisher to verify the uploaded
objects, activate the snapshot, and confirm the public revision. If another
publication changes the active revision, stage again against that revision.

For direct publication through a reviewed executor, use:

```sh
node web/scripts/upload-library.mjs --dry-run
node web/scripts/upload-library.mjs --r2 --deployment HOSTNAME --executor /absolute/path/to/approved-publisher
```

Run these commands from the repository root after `uv run yomiru publish`.
`--library-dir /path/to/library` selects a different complete local library.
The dry run validates assets and prepares catalogue metadata without uploading.
Individual assets and the index/catalogue snapshot must each fit the 3 MiB
upload limit and the 4 MiB JSON request limit after base64 encoding.
The executor accepts one JSON request on stdin with `method`, `url` and an
optional `body`, and returns `{ "status": 200, "body": { ... } }` on stdout.
Use a Runbox-backed executor with owner-approved GET and POST access to the
exact protected deployment's `/api/admin-publish` route. Verify that its
transport brokers the required Vercel deployment-protection header before
enabling writes. The uploader stops if the executor is missing or refuses the
request. New episodes require no website build or deployment.

Keep Vercel Authentication enabled for all deployment URLs, excluding custom
domains. The upload API accepts only the exact protected Production deployment
hostname. The public custom domain returns 404. `--deployment HOSTNAME` targets
a reviewed staged Production deployment.

The upload command with `--r2` gets its R2 origin and current revision from the
protected deployment endpoint. It verifies the uploaded immutable objects before activating the
matching catalogue and vocabulary in one database transaction. A concurrent
publisher must start again from the new active revision. Stable Stremio and
website URLs continue to resolve the same content-addressed tracks. API and
Stremio caches can briefly retain the previous publication after an update.

The upload keeps immutable snapshot and vocabulary assets for administrator
restore. Public catalogue and subtitle discovery read the active Neon
publication, and the selection counter reads the vocabulary rows in Neon.
Keep a separate backup of the administrator library and original generation
inputs. To restore the library, download `/library/index.json` and its referenced
content-addressed assets, preserving the full index. Run the dry check before
adding episodes. Website deployment and library publication are separate.

### Incremental episode upload

Once the incremental catalogue is active, prepare each upload in its own
`--data-dir`. Pass the original Japanese file and `--archive-dir` to `yomiru
publish`. Use its `source_archive.manifest.sha256` for `--archive-manifest`.

```sh
node web/scripts/upload-episode.mjs --dry-run \
  --library-dir .local/episode --archive-dir .local/source-archive \
  --archive-manifest MANIFEST_SHA256
```

For publication, replace `--dry-run` with `--executor` and `--deployment`
using the reviewed publication route. The command verifies one episode or
movie with its tracks, vocabulary and private archive. The vocabulary must
include every word in the analysis with its matching count. It sends source objects
to the private bucket and subtitle assets to the public bucket. A single
database transaction makes the changes visible. An identical retry reuses the
objects and the recorded publication result. Dictionary-only reviews do not
invalidate a subtitle upload while its objects are being transferred.

To hide selected movie tracks from discovery, submit `retire-movie-tracks` to
the protected incremental publisher with the movie's `videoId`, the exact
`trackIds`, and its current catalogue revision as `previous`. At least one
discoverable track must still match the movie's vocabulary. Saved track links
continue to serve the retired files.

Use `withdraw-movie-tracks` with the same fields to withdraw a movie's final
discoverable track. Its saved track links and vocabulary are retained. The
movie returns to discovery when a replacement track is published.

To permanently remove a retired standalone rōmaji movie track, submit
`purge-retired-movie-romaji` with its `videoId`, exact `trackId`, and current
catalogue revision as `previous`. The English + rōmaji replacement must already
be discoverable with matching vocabulary. The publisher removes the saved
links and deletes the unshared ASS and playback copies from public R2. An
identical retry resumes storage deletion using the recorded object paths.

Use `--script romaji` when preparing English + rōmaji from translation pairs.

To prepare a standalone rōmaji movie track, use the Japanese captions directly.
The track appears under Japanese in Stremio and contains the rōmaji line.

```sh
uv run yomiru publish --romaji-only --type movie --video-id IMDB_ID \
  --japanese-source ORIGINAL.srt --archive-dir .local/source-archive \
  --data-dir .local/episode --source-label SOURCE_RELEASE --source-url SOURCE_PAGE
```

For an existing title, pass the retained `--pairs` alongside the original file
to preserve its Japanese anchor. Use the incremental upload command above with
the resulting archive manifest.

Use a separate R2 bucket with public endpoints disabled for the source archive.
Store the four archive settings in the `yomiru-production` Infisical project's
Production environment. The pinned production delivery workflow syncs only
these settings to Vercel Production after CI succeeds. The hosted runtime takes
`SOURCE_ARCHIVE_R2_ENDPOINT`,
`SOURCE_ARCHIVE_R2_BUCKET_NAME`, `SOURCE_ARCHIVE_R2_ACCESS_KEY_ID` and
`SOURCE_ARCHIVE_R2_SECRET_ACCESS_KEY` through approved provisioning. Use a
credential scoped to that bucket. The public library serves the existing
subtitle bucket and keeps source archive paths private.

The Vercel project links to the canonical GitHub repository so the workflow can
verify both identities before syncing. The root `vercel.json` disables Git
deployments. The reviewed app release publishes the committed `web` tree after
CI and Production synchronization succeed.

### Incremental cutover

Prepare the app release and review the production upload route. Pass an
`incremental` object with `action: "bootstrap"` and the current `revision` to
the protected `/api/admin-publish` endpoint. This copies the legacy library
while the current readers keep serving. Run `action: "parity"` at the same
revision to compare track identities and vocabulary rows. After verifying
private bucket access, use `action: "cutover"` with that revision and
`serving: true`. The database compares both stores again and closes legacy
activation in the same transition. Public subtitle and feedback URLs stay stable.

Before accepting the first incremental upload, validate the live add-on and
vocabulary queries. During this window, `serving: false` with the same revision
switches readers back. The database refuses that switch after an incremental
change until the legacy publication catches up. For recovery within the legacy
snapshot format's limits, `action: "recover-legacy"` takes the exact current
incremental `revision`, exports the current data, verifies the immutable assets,
and activates the restored legacy snapshot atomically. Keep legacy snapshots
and the incremental change journal for recovery.

### Archive an existing episode or movie

With the original Japanese subtitle file and the retained pairs for the active
tracks, prepare the archive without generating new subtitle files.

```sh
uv run yomiru archive-source --pairs /path/to/pairs.json \
  --japanese-source /path/to/original.ass --archive-dir .local/source-archive
node web/scripts/upload-episode.mjs --existing-video-id tt1234567:1:1 \
  --archive-dir .local/source-archive --archive-manifest MANIFEST_SHA256 \
  --executor EXECUTOR --deployment HOSTNAME
```

Use the reported `source_archive.manifest.sha256`. The original file is retained
byte for byte, including cues excluded from the published dialogue. The
attachment checks the published Japanese anchor and vocabulary.
It updates the private receipt without changing subtitle URLs, word counts or
the public revision. Repeating the same attachment is safe.

### Move an existing Blob publication to R2 and Neon

Set up Production delivery through the trusted shared workflow used by the
other Vercel apps. Its reviewed mapping binds the canonical GitHub repository,
an isolated Infisical Production vault and the Vercel project by identity.
The sync job sends only the allowlisted values to Production after the current
main commit passes CI. Keep Vercel's Require Separate Values setting enabled.

Use `yomiru-production` for the Infisical vault, `yomiru` for the R2
bucket and `yomiru-neon` for the Neon project.

| Production fields | Classification |
| --- | --- |
| `DATABASE_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Secrets |
| `PUBLIC_R2_ORIGIN`, `R2_ENDPOINT`, `R2_BUCKET_NAME` | Server configuration |

Approve a separate Yomiru Runbox route for local publication after the staged
hostname and its authorization source are confirmed. Keep the R2 token
scoped to Yomiru's bucket and separate from development and preview tokens.

1. Connect the Vercel Production deployment to Yomiru's Neon database and R2 bucket.
   Apply [the database schema](../web/db/schema.sql) through the approved database
   provisioning route. A local agent command requires its own reviewed Runbox
   profile for that operation. Configure a cache-enabled R2 custom domain
   and allow GET and HEAD from Yomiru/Stremio clients. Set the Production-only
   variables `DATABASE_URL` (pooled URL), `PUBLIC_R2_ORIGIN` (HTTPS origin
   without a trailing slash), `R2_ENDPOINT` (R2 S3 endpoint),
   `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.
   Supply the Neon connection and bucket-scoped R2 object read/write credential
   through approved provisioning into the hosted runtime. Local Runbox
   sessions cover operator commands. Vercel supplies the runtime configuration
   to the deployed server. Server-side validation and subtitle rendering use
   authenticated R2 reads. Client-facing asset links use the public R2 origin.
2. Keep the existing public and private Vercel Blob bindings with OIDC during the
   import. Pause catalogue publishing. Deploy the legacy configuration with
   `YOMIRU_PAUSE_FEEDBACK=1` and wait for in-flight writes to finish. Stage
   the R2/Neon deployment with the same pause and `YOMIRU_IMPORT_BLOB=1`.
   Existing cached tracks and previously saved feedback remain readable during
   the pause. New feedback links and votes resume after cutover.
3. Check the approved publication profile offline and run its bounded read-only
   probe. Run the upload command above with the exact protected staged hostname
   and add `--migrate-from-blob`. It copies and verifies public
   content-addressed library objects, then imports short links, releases, binary
   votes and star ratings without exporting private records to the command line. It activates the
   exact existing publication in Neon after the import. The command can be
   repeated against the same frozen source.
4. Verify the endpoints below on the staged deployment, including old feedback
   links and the vocabulary selection summary. Promote the verified configuration
   with `YOMIRU_PAUSE_FEEDBACK` and `YOMIRU_IMPORT_BLOB` removed. Retain the old
   Blob stores for cached redirects and recovery. During the read-only cutover
   window the existing deployment is the rollback target.

For existing Neon deployments, apply the additive `yomiru_subtitle_rating`
table in [the database schema](../web/db/schema.sql) before deploying the rating form.
For existing incremental deployments, apply [the serving migration](../web/db/serving.sql)
through the approved database provisioning route before releasing paginated
vocabulary reads. It backfills per-title word counts, public frequencies, a
compact dictionary search projection and the default summary in PostgreSQL.
The catalogue page returns the default count alongside the titles. Publication
changes keep the projections and summary current in the same transaction. New
incremental bootstraps install both schemas.

An unconfigured deployment still uses its legacy Blob bindings. A deployment
with either Neon or R2 selected requires both connections. Keep Preview and
Development credentials separate from Production.

## Source observations and feedback

Neon stores source observations, votes, and short-link contexts. Existing
feedback links retain their original episode, subtitle revision, and video
source. The playback render gives paired dialogue explicit positions so
Android ExoPlayer keeps the lines together. It leaves dialogue text, timings,
and published assets intact. R2 caches the render under `feedback-tracks/v4/`.
The subtitle picker includes the rendering version in the URL to refresh
previously cached responses. A missing or corrupt asset returns a track error.

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

- `/manifest.json`: Stremio manifest with subtitles and both 🦊 Yomiru Discover
  catalogues, public CORS, no local URLs.
- `/catalog/movie/published-movies.json` and `/catalog/series/published-series.json`:
  the published movie and series titles, one entry per Cinemeta ID. Check that a
  newly covered title appears after the library publication and cache refresh.
- `/catalog/series/available.json`: empty results for older installations.
- `/api/browse`: published episodes with standard Stremio deep links.
- `/subtitles/series/VIDEO_ID.json`: exact episode's four display variants.
- `/subtitles/movie/IMDB_ID.json`: the movie's published reading modes and translations.
- `/subtitles/series/VIDEO_ID/filename=RELEASE.json`: episode resource when
  Stremio supplies filename/hash extras. Track metadata records timing uncertainty.
- Each returned HTTPS `.ass` URL: correct hash, ASS header and styled cues.
- `POST /api/vocabulary-selection` with pinned episode vocabulary revisions: exact
  unique-word count and meaning coverage. Check Browse words and Download CSV in
  the website, including a selection with words shared across episodes.
- An unpublished episode: successful response with an empty subtitle array.

Install the hosted add-on and verify the picker/download path on each episode.
Remove old local Yomiru/pilot installations only after this works. Retain
generation inputs and evidence; retire active local copies and Yomiru's
background service separately from unrelated services.
