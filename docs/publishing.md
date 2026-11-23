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

This produces rōmaji, kana and original Japanese in the ignored `.local/published/` library.
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
vocabulary. The three reading modes are available for each target language.
Vocabulary study and export use English meanings for every episode.

The public index contains IDs, content hashes, source attribution, language,
display mode and timing limitations. Original downloads, prompts, credentials,
account details, local paths and private reports are not exported. Subtitle
assets are immutable and addressed by their SHA-256 content hash.
Each playback-ready ASS already includes the positioning used by Stremio.
Stremio discovery advertises `https://assets.yomiru.tsilva.eu/library/<sha256>.ass`.
Existing website download links redirect to the same R2 object. The asset host's
Cloudflare Cache Rule makes these ASS files eligible for edge caching and uses
the object's one-year immutable cache header. A corrected file gets a new hash.
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

The website's subtitle library derives its coverage from this index. Three display
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

For a new episode or movie, or maintenance of an existing title, follow the
[episode workflow](../.codex/skills/yomiru_manage-episodes/SKILL.md).
New titles default to Kana + English and Rōmaji + English with original artwork.
Stage both in the same library directory before review, using `yomiru publish`
with `--script kana` and `--script romaji` and the same validated pairs, source
archive and vocabulary inputs. After confirming the title identity, artwork
and translation can run in parallel. Save the selected illustration as a static
640 × 360 WebP under 1 MiB
and pass it as `--artwork PATH` with the episode commands below. The library
uploads the content-addressed image and activates it alongside the episode.
Review can start before the artwork is ready. Adding or replacing the image
keeps the subtitle and review checkpoints reusable.
Older episodes can still use their bundled gallery artwork. For a local gallery
preview, set `YOMIRU_EPISODE_ARTWORK` alongside `YOMIRU_LIBRARY_DIR`.

Once the incremental catalogue is active, prepare each upload in its own
`--data-dir`. Pass the original Japanese file and `--archive-dir` to `yomiru
publish`. Use its `source_archive.manifest.sha256` for `--archive-manifest`.

For English or European Portuguese bilingual tracks, prepare a private review
packet from the repository root with the original validated pairs.

```sh
node web/scripts/release-episode.mjs --prepare-review .local/episode-review \
  --library-dir .local/episode --archive-dir .local/source-archive \
  --archive-manifest MANIFEST_SHA256 --pairs PATH_TO_PAIRS \
  --artwork .local/episode.webp --resume-dir .local/episode-checkpoints
```

Complete `review.json` using the [episode review procedure](subtitle-quality.md#episode-release-review).
Validate it against the staged episode before using the executors.

```sh
node web/scripts/release-episode.mjs --dry-run --review .local/episode-review/review.json \
  --library-dir .local/episode --archive-dir .local/source-archive \
  --archive-manifest MANIFEST_SHA256 --pairs PATH_TO_PAIRS \
  --artwork .local/episode.webp --resume-dir .local/episode-checkpoints
```

Completed English release reviews save their matches in
`.local/practice-matches/` for subsequent drafts. Add
`--save-reviewed-matches` to a dry run to save a completed review locally.
Use `--matches-dir PATH` to select a different private store in both
commands. The store keeps validated reviews separately by review ID.

For an authorized release, keep `--review` and replace `--dry-run` with
`--corpus-executor`, `--executor` and `--deployment` for the approved routes.
Add `--preflight` to stage the exact reviewed corpus and immutable assets,
rehearse activation against the live dictionary, and roll back the activation
transaction. Preflight can write staged objects and private corpus inputs.
Conflicts identify the cue, vocabulary ID, and reason. A release automatically
runs the preflight, then rechecks inside the activation transaction against
the same catalogue revision. The episode executor accepts `preflight-episode`
and `publish` with `previous`, `pointer`, `manifest` and `reviewId`, and public
object uploads at `/library/<sha256>.webp`.

The corpus executor takes the reviewed package on stdin and returns the
stored cue sequences and review ID. Apply the current
`web/db/practice-context.sql`, `web/db/subtitle-corpus.sql`, and
`web/db/episode-corpus-publisher.sql` as the database owner before deploying
the reviewed publication path. The last script can update an existing
publisher without replacing its login. A separate app reader role needs the
existing corpus schema usage and `SELECT` access to `release_review` as well
as the other corpus tables used by Practice. Use the existing executor for
subsequent releases.

The release checks archived inputs, review identity, full English Practice
coverage and choices, then replays every question with the quiz and mastery
engine. The publisher stages the exact translation and reviewed questions
privately, renders from stored cues, and compares bytes to the staged track.
For a name with ruby on only the surname, the renderer can apply a reviewed
reading to the adjacent given name while preserving the source ruby.
Catalogue activation requires that review for the active vocabulary and each
new bilingual track. After activation the command checks Stremio discovery
and replays the full English exercise from the public service, including
subtitle order, exact highlights, answer choices, and mastery IDs. An identical
retry is safe. A changed source, paired translation or vocabulary requires its
own review. Keep the same `--resume-dir` to reuse the local corpus and reviewed
package by their verified identities. If activation succeeded and verification
was interrupted, replace the executor arguments with `--verify-only` to check
the exact staged episode and exercise without publishing. The command reports
reused stages and elapsed time by stage.

For standalone rōmaji and maintenance operations, use
`node web/scripts/upload-episode.mjs` with its documented arguments. Its
ordinary episode upload prepares files and vocabulary without importing paired
subtitle cues.

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
deployments. A successful push CI run synchronizes Production configuration.

An explicit owner release uses **Actions → Production delivery → Run workflow**
on `main` with the exact approved commit in `release_sha`. GitHub checks CI and
syncs Production before the publish job stages the committed `web` tree on
Vercel, verifies the staged build, and promotes it to the public domain. A
dispatch with an empty SHA only synchronizes configuration. The publish job uses
the existing project-scoped `VERCEL_TOKEN` from GitHub's Production environment.
The run summary records the deployment ID, and the live manifest confirms the
published version.

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

### Regenerate tracks from PostgreSQL

The private subtitle corpus stores versioned Japanese cues, token positions,
translation timelines, and the headers and ordered event lines of existing ASS
revisions. Regenerate any supported reading mode for a title and language with
stored inputs. Rebuild an existing track by ID to obtain its original bytes.
Translations recovered from a rendered track retain that track's timing and
provenance. They may have merged or wrapped cues from the original export.

To prepare a corpus from a published index, use
`uv run python scripts/prepare-subtitle-corpus.py --help`. Supply the index,
verified Japanese manifest paths keyed by anchor, retained pair paths keyed by
generation SHA-256, published ASS files named by their checksums, and vocabulary
documents named by Japanese anchor. Keep the resulting compressed package in
private, ignored storage. Optional reviewed practice entries and cue exclusions
are keyed by Japanese anchor. They must refer to real occurrences and current
quiz meanings.

Run the database commands from the repository root. Use a local PostgreSQL
socket and the exact publication revision. Each import verifies the exact ASS
checksums before committing the data and the practice projection.

```sh
node web/scripts/subtitle-corpus.mjs import --socket "$SOCKET" --input "$CORPUS"
node web/scripts/subtitle-corpus.mjs verify --socket "$SOCKET" --publication "$REVISION"
node web/scripts/subtitle-corpus.mjs render --socket "$SOCKET" --publication "$REVISION" \
  --track "$TRACK_ID" --out restored.ass
node web/scripts/subtitle-corpus.mjs render --socket "$SOCKET" --publication "$REVISION" \
  --video "$VIDEO_ID" --language eng --script kana --out kana-english.ass
```

The verifier reproduces each published hash and renders every available
title-language combination in each supported reading mode. Stage resulting ASS
assets through the existing publisher when a public release is authorized.
To add Kana for a title with a legacy single-script track, prepare a new
`yomiru publish --script kana` track from the same Japanese anchor and translation.

Install `web/db/practice-context.sql` with the serving projections. For a database
import, use an approved private database route and verify the track counts and
hashes against the published index. Rebuild and reimport older projections to
include all aligned cues and word positions, including repeated words. Open
Practice and check that the first phrase shows its English line and that the
quiz advances through its eligible words in order.

To deliver rebuilt practice analyses through the private source archive, run
`uv run python scripts/prepare-practice-assets.py CORPUS OUTPUT` on a verified
corpus. Upload each content-addressed analysis through the protected private
object publisher and verify its returned checksum. Copy the resulting
`manifest.json`, which contains checksums and byte counts, to
`web/lib/practice-archive.json` for the app release. The server uses an archived
analysis only for the selected titles' current Japanese source revisions and
resolves peek meanings against the current dictionary. Keep the compressed
analysis files and subtitle content in private storage.

A playback-only migration keeps existing Practice reviews attached through the
canonical track ID derived from the reviewed track and the new ASS checksum.
Verify that previously supported titles still open Vocabulary after retiring
the old track records.

For a phrase coverage backfill, add the verified source descriptors from that
manifest under the existing app manifest's `phrases` field. Keep the existing
example index and source descriptors. Publish the app after the private object
publisher has confirmed every checksum. Phrase Practice reads the rebuilt
word positions for each current source and pairs them with its active English
translation at serving time.

For an episode with reviewed questions, supply the exact private Japanese
source, paired English revision, published vocabulary, and reviewed occurrences
to `uv run python scripts/prepare-reviewed-practice.py SOURCE ENGLISH VOCABULARY REVIEW OUTPUT`.
Each reviewed target identifies a cue, source character span, vocabulary ID and
two to four choices with the answer first. The compiler verifies the source
span and vocabulary link, aligns the display highlights, and includes the
English text by cue ID. The private asset also accounts for each source cue and
span. Its coverage records distinguish ready questions, unresolved entries,
unaligned readings, grammar, exclusions and separators. Review those records
independently of session pacing. For an exhaustive episode, use
`--require-complete` to catch any unresolved occurrence before staging.
Review every choice before staging the content-addressed
object under `phrases` in the Practice archive manifest. Recompile that asset
when selecting a different English revision for the episode's Practice.

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
vocabulary reads. It backfills per-title word counts and encountered forms,
public frequencies, dictionary search keys and the default summary in PostgreSQL.
The migration also prepares playable card definitions for bounded practice batches
and exact mastery membership checks. Reapply the serving migration before
releasing the particle exclusion so existing practice and mastery projections use
the same eligibility as new publications.
Apply [the practice postings migration](../web/db/practice-postings.sql) after
the serving migration on existing installations. It packs exact per-title counts
using numeric word keys so custom selections can aggregate them with fewer
database reads. Publication changes refresh the affected title packs and card
eligibility in the same transaction.
Apply [the practice band migration](../web/db/practice-bands.sql) after the
practice postings migration on existing installations. For selections of 32
titles or more, it batches dense groups of word counts with exact arithmetic
and retains sparse counts separately. It signs one upcoming rank window and
the counts of cards already loaded so a refill can reuse them across serving
instances. The app allows up to eight concurrent connections per instance when
the configured Neon endpoint uses its pooler.
The catalogue page returns the default count alongside the titles. Publication
changes keep the projections and summary current in the same transaction. New
incremental bootstraps install these migrations automatically.

An unconfigured deployment still uses its legacy Blob bindings. A deployment
with either Neon or R2 selected requires both connections. Keep Preview and
Development credentials separate from Production.

## Source observations and feedback

Neon stores source observations and compatibility votes. Published playback-ready
ASS gives paired dialogue explicit positions so Android ExoPlayer keeps the
lines together. The retired playback and subtitle rating URLs return HTTP 410.

After the app release, run `node web/scripts/migrate-playback-tracks.mjs` to
list active revisions that still need playback positioning. Use the same
command with `--apply --deployment <deployment-host> --executor <absolute-path>`
through the approved publication route to migrate them in batches. Repeat
`--track-id <id>` to select specific tracks. Each batch verifies the immutable
R2 files before activating the replacements. On interruption, rerun the dry run
to see which tracks are still pending.

After migration, verify direct asset URLs in Stremio discovery and check that a
repeated request returns `CF-Cache-Status: HIT`. The protected cleanup actions require every
active track to be playback-ready. `purge-superseded-tracks` takes the current
catalogue revision as `previous` and up to eight exact superseded `trackIds`.
It deletes only ASS objects that no remaining track shares. An identical retry
resumes storage deletion using the recorded keys. `purge-legacy-playback` takes
the current catalogue revision as `previous` and removes up to 24 generated
legacy playback files at a time. An empty key list confirms that prefix is clear.

Only sanitized video basenames, optional OpenSubtitles hashes/file sizes, seen
timestamps and scoped anonymous votes are retained. The public API exposes source
metadata and aggregated Works/Doesn’t work counts, never stored voter digests.
No identity is inferred when Stremio omits both filename and hash.

Publishing a changed subtitle revision starts a fresh feedback group. Existing
private records are retained, with no automatic carry-over of votes or fabricated
confirmation. [Viewer instructions](usage.md) explain the source list, unrated
filter, pooled percentages and limits of anonymous browser voting.

## Clean up unreferenced ASS files

Apply [the subtitle upload migration](../web/db/subtitle-uploads.sql) through
the approved database route. New incremental bootstraps install it automatically.
Use a protected deployment that supports subtitle cleanup and an approved
executor for its admin route.
For a signed-in Vercel team member, the same read-only preview is available at
`/api/admin-publish?action=plan-subtitle-cleanup` on the exact protected
deployment hostname. Follow each `next` cursor as `after` with the first
response's `revision` as `previous` to complete the preview.

```sh
node web/scripts/cleanup-subtitles.mjs --deployment HOSTNAME --executor EXECUTOR > cleanup-plan.json
```

The default command lists exact keys, sizes and modification times. It
compares the R2 inventory of canonical `library/<sha256>.ass` objects
with active Neon tracks. A recent object or a current upload reservation
protects a file for 24 hours. Reusing an older file through the episode
publisher refreshes that reservation. Objects that never entered the catalogue
can still be found by the next dry run.

Review the plan before applying it. Route episode publication and playback
migration through the updated protected deployment before enabling deletion.
Older deployments do not register upload reservations or recheck the R2 object
under the catalogue lock during activation. Drain uploads on those deployments
before applying a plan.

```sh
node web/scripts/cleanup-subtitles.mjs --deployment HOSTNAME --executor EXECUTOR --apply-plan cleanup-plan.json
```

Apply rechecks the catalogue, upload reservations, and R2 metadata before
deleting the reviewed keys. A changed catalogue or newly protected object
requires another dry run. An exact retry can finish a partially deleted batch.
Cleanup records the exact keys before removing them from R2. Older publishers
reject those keys after the receipt commits. Updated publishers verify an
object exists under the catalogue lock before publishing it again. Existing
Cloudflare and browser copies can remain for the duration of their cache lifetimes.

Run the GitHub workflow from an authenticated GitHub CLI session.

```sh
gh workflow run subtitle-cleanup.yml --repo tsilva/yomiru --ref main
```

The owner-triggered workflow uses GitHub OIDC to call the cleanup-only endpoint.
The dry run logs counts and a fingerprint. Inspect the exact keys in the
protected preview before passing the same fingerprint as `reviewed_sha256`
in a separate dispatch. If the live candidates differ, the workflow stops
before deletion. After applying, it lists the inventory again to verify the
reviewed keys disappeared and every active path still exists.

## Verify and migrate

Check these public endpoints after uploading:

- `/manifest.json`: Stremio manifest with subtitles and both 🦊 Yomiru Discover
  catalogues, public CORS, no local URLs.
- `/catalog/movie/published-movies.json` and `/catalog/series/published-series.json`:
  the published movie and series titles, one entry per Cinemeta ID. Check that a
  newly covered title appears after the library publication and cache refresh.
- `/catalog/series/available.json`: empty results for older installations.
- `/api/browse`: published episodes with standard Stremio deep links.
- `/subtitles/series/VIDEO_ID.json`: available reading modes for the exact episode.
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
