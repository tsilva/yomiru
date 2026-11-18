# Hosted library

Choose **Install in Stremio** at [Yomiru](https://yomiru.tsilva.eu) to open the guide,
then choose **Install in Stremio** inside it to open the app and confirm
installation. The add-on uses Yomiru's fox icon.
If the app does not open, the same guide includes the manual
`https://yomiru.tsilva.eu/manifest.json` URL. On an available
episode, select a **🦊 Romaji** subtitle entry and enable **Style ASS subtitles**.
Choose rōmaji, hiragana, katakana or original Japanese. Tracks come from the
administrator-published library; no local process or provider key is needed.
Coverage and video timing vary by source. An absent episode has no Yomiru entry;
watching does not start generation. See [publishing](publishing.md) for
administrator preparation and uploads.

The fox identifies Yomiru in Stremio's subtitle picker. Rōmaji is listed first,
followed by hiragana, katakana and original Japanese. Find the hosted variants
under **English** or **Portuguese**, based on the language of the meaning line.
The Portuguese tracks use European Portuguese, and both translations use the
same Japanese source. Set Stremio's preferred subtitle language to the translation
you want and select **🦊 Romaji** when needed.
Some Android builds show **Yomiru** for each reading mode. Yomiru sends rōmaji
first within each translation language.
The add-on cannot force its variant over embedded tracks or other add-ons;
saved selections depend on the Stremio client.

Open your show from your usual Stremio catalogue, then select an episode and a
stream from your existing add-ons. Yomiru appears in the subtitle picker when
it has tracks for that episode. Timing can vary by video release.

Use **Browse subtitles** beneath the install button, or scroll below the hero
on [Yomiru's website](https://yomiru.tsilva.eu), to search
the published subtitle library by show, episode, season or translation language.
The compact table lists each available episode once with its season and target
languages; reading modes do not count as separate translations. More episodes
load automatically near the page bottom, with a **Load more episodes** button
also available. The violet play button in each row opens that episode's stream
choices in Stremio. Select the desired Yomiru reading mode in the player's
subtitle picker. The table lists subtitle availability. Release uncertainty
remains in the published track metadata. A failed library request can be retried
without losing existing rows.

Hosted learning tracks show a compact, centered feedback card at **00:00–00:03**.
Scan its QR code or type the blue URL. Seek back to the start and pause to scan
it later. The page shows the episode and the Yomiru subtitle track from the link.
Choose 1–5 stars, optionally leave a comment, and select **Submit feedback**.
Return to the same link in the same browser to edit your feedback. Comments are
private to the operator. Older links that covered multiple reading modes show
the translation language alone.

## Updates

The hosted add-on keeps the same manifest URL and ID across releases. Server
improvements apply to subsequent requests without a local download. Each API
request checks the published-library pointer for new or revised subtitles;
bucket and API caches can delay updates by about 90 seconds, plus Stremio's cache.
Adding episodes or revising tracks does not require reinstalling the add-on.

The manifest exposes a semantic version and revalidates on subsequent fetches.
Stremio controls whether and when it refreshes metadata saved at installation;
Yomiru cannot detect the installed version or force an update inside the player.
If Stremio still shows an **Available with Yomiru** or **Available on Yomiru**
catalogue after the update, reinstall Yomiru from the same manifest URL to refresh
the saved add-on details. You can use the regular show entry while it refreshes.

# Automatic discovery

The local workflow below remains available for manual discovery and offline work.

Start the local add-on once, add its printed manifest URL in Stremio, and select
Yomiru in the subtitle picker on each episode. Rōmaji is the default display.

```sh
uv run yomiru serve --port auto
```

Use `--script hiragana`, `--script katakana` or `--script japanese` to change the
learning line. `--all-scripts` offers all four. These options affect automatically
discovered tracks; manually built tracks retain their own display.

Kitsunekko supplies Japanese captions. The official Stremio OpenSubtitles v3
add-on supplies English, with Kitsunekko's English directory as a fallback.
IMDb catalog IDs resolve through Cinemeta. AniList supplies verified alternate
titles when a directory is named differently. Kitsu, AniList and MAL episode IDs
also resolve, but English coverage can be smaller than through an IMDb catalog.
No account or provider API key is required.

Both languages must be available for the requested episode. Series need a season
and episode, or a season-specific anime ID and episode. Yomiru checks explicit
`S01E01`, `01` or `第01話` numbering and scans supported ZIP members in memory.
For later TV seasons, plain absolute numbering is accepted only in a matching
season directory; Yomiru does not guess how TV seasons map to absolute episodes.
RAR/7z bundles, image subtitles, specials without an explicit identity, and fuzzy
title-only matches are unsupported. Missing coverage yields no automatic track.

The subtitle list is discovered first. Each Yomiru entry identifies a particular
base source and Japanese source. Selecting it downloads that pair, converts the
learning line and caches ASS. A failed base download never silently selects a
different source. There may be two Japanese source options for each base track.
Repeated selections reuse the generated result, including across server restarts.
The provider response cache is limited to approximately 96 MiB of payloads.

**Timing remains unverified.** Japanese files are ranked using the video filename
when Stremio supplies it; English candidates use the upstream provider's order.
Automatic discovery can correct a small, consistent Japanese offset against the
base captions; see [relative timing](#relative-timing). Sources can belong to different
edits, and neither caption alignment, filename similarity nor conversion proves audio sync.
Use a different source option or the manual workflow below when timing differs.

## Choosing a source in Stremio

Use Stremio's normal subtitle menu. Under English (the default base language),
choose an entry such as **Yomiru #…: romaji (auto timing) + English track …**.
The label identifies both sources. Yomiru offers up to 32 distinct base sources
per request, paired with at most two Japanese sources and the configured display
modes. It loads only the pair you select.

Variant numbers distinguish entries within the current list; they are not quality
rankings or stable provider IDs. Full labels identify the base track and Japanese
version. Multiple base translations paired with two Japanese versions create
multiple choices; for example, six base tracks produce twelve entries.

Known sparse song/sign tracks are omitted from discovered bilingual choices.
Coverage checks require both a very small cue count and little total caption time
relative to a substantial Japanese source. They are conservative, not a guarantee
that a translation covers every line. Unseen sources are checked when selected;
a clearly sparse base fails explicitly and disappears on the next list refresh.
Listing reuses fresh cached evidence without downloading every candidate. Supplied
manual caption files remain usable without this automatic-discovery filter.

Choose an ordinary subtitle entry to watch without Yomiru. There is no browser
extension, developer-mode installation or player modification. The standard
Stremio add-on API does not tell Yomiru which track another add-on selected, so
Yomiru cannot attach itself to an arbitrary existing selection; its own entry
supplies the combined ASS.

Source choices cover Yomiru's supported providers, not every installed add-on or
embedded stream. Use supplied files below when the desired source is unavailable.
For a different base language, start a server with its three-letter language code:

```sh
uv run yomiru serve --port auto --base-language spa
```

Install that server's printed manifest URL. The default managed service remains
English. Missing captions in the requested language do not fall back to English.

To diagnose availability without opening the player:

```sh
uv run yomiru discover --video-id tt0112159:1:1
```

This diagnostic builds the first usable pair and prints its source and asset path. Exit code 1 means
no usable pair was found; upstream failures are reported separately. It is a
diagnostic tool, not a required per-episode step. The subtitle JSON response also
contains a `yomiru` diagnostic object; Stremio itself may not display that object.

Use `--no-discovery` to serve only manually built tracks. The service must stay
running. Follow the fixed-port or background-startup instructions below for a
reusable installation URL.

## Build and watch a track

Supply UTF-8 Japanese and English SRT, ASS/SSA or WebVTT files for the same episode and
video release. Do not generate Japanese dialogue from an English translation.

```sh
uv run yomiru build \
  --japanese /path/to/episode.ja.ass \
  --english /path/to/episode.en.srt \
  --video-id tt0000000:1:1 \
  --script romaji \
  --release ExampleRelease \
  --width 1440 --height 1080
```

Replace the illustrative video ID and paths with the actual episode's values.
The default type is `series`; movies use `--type movie` and their movie ID.
Use `1920 × 1080` for 16:9 video or `1440 × 1080` for 4:3 video. Match the aspect
ratio rather than guessing from a release's 720p/1080p label.

## Japanese display

| Mode | Output |
| --- | --- |
| `romaji` | Latin-script reading, using Hepburn-style conversion |
| `hiragana` | Dictionary readings rendered in hiragana |
| `katakana` | Dictionary readings rendered in katakana |
| `japanese` | Source kanji and kana, with pronunciation annotations removed |

Inline guides such as `東京(とうきょう)` supply the reading while retaining
`東京` in original-Japanese mode. Speaker and sound descriptions in parentheses
are removed from the learning line. Reading quality is not guaranteed; unknown
words may retain source characters. Neither conversion nor a filename match
establishes audio synchronization.

Run `build` again with another `--script` to offer multiple manual tracks for
the same episode. Each mode gets its own cache key. Appearance options are
`--japanese-colour '#FFEAB5'` and `--english-colour '#A8E6FF'`. These appearance
options and `--width`/`--height` are also available on `serve` and `discover`.
Automatic tracks default to a 1440 × 1080 canvas; Stremio does not supply video
dimensions through the standard subtitle request. Set a 1920 × 1080 canvas for
widescreen viewing if needed.

All reading modes keep the Japanese and English regions close together: the
reserved gap is 4 pixels on a 1080px-high subtitle canvas and scales with height.
Japanese wraps upward and English wraps downward so longer captions remain
separate. Existing generated files retain their appearance until rebuilt;
published updates use new immutable subtitle assets.

## Relative timing

Automatically discovered entries marked **(auto timing)** estimate a constant
Japanese offset relative to the selected base captions. They compare caption
starts throughout the episode, search within two seconds, and apply a correction
only when there are enough matches, a clear improvement and consistent evidence
across the timeline. English/base timing stays unchanged. After a reliable fit,
it also aligns the start/end of mutually unique cue pairs whose boundaries are
already within 250 ms. This removes small per-line gaps that a whole-track shift
cannot fix. Already-close tracks can receive this boundary adjustment without
an unnecessary global shift. Different segmentation, ambiguous pairs, short
excerpts and changing offsets are left untouched; captions are never split or
given another cue's text. This does not listen to audio or repair different
edits/framerates. Check the result against the Japanese audio.

Reopen the episode and reselect an **(auto timing)** entry after updating. Old
assets are retained; new timing settings produce distinct discovery/cache keys.
Provenance and the ASS header record the global offset and how many cue pairs
received boundary adjustments. Fitting-version changes also produce new assets.

Foreground servers support independent manual delays, in milliseconds. Positive
values make that language appear later; negative values make it appear earlier.
For example, to retain source timing but delay Japanese by half a second:

```sh
uv run yomiru serve --port auto --no-align-timing --japanese-delay-ms 500
```

`--base-delay-ms` adjusts the lower language separately. Manual delays apply on
top of automatic correction when `--align-timing` is enabled. Use Stremio's own
subtitle delay only when both languages need to move together relative to audio.
Install the foreground server's printed URL to use its settings; the managed
service uses automatic relative timing with no manual delays.

`build` preserves supplied cue times by default and accepts these same delay
flags; add `--align-timing` to request fitting. `discover` enables fitting by
default; `--no-align-timing` disables it. Cues shifted before time zero are clipped
or omitted. Original source documents are never modified.

## Serve in Stremio

```sh
uv run yomiru serve --port auto
```

Paste the printed manifest URL into Stremio's **Addons → Add addon**, install
Yomiru and select its subtitle track while watching the matching episode.
Enable **Settings → Player → Style ASS subtitles**. Clients with incomplete ASS
support may render differently; the initial delivery target is local desktop use.
The add-on offers subtitles, not a video catalog or player.

In Stremio Web, the browser must allow the site to access the local network.
If the manifest fails to load while its URL opens directly, check that site
permission. The desktop Stremio app can also install the same manifest URL.
Paste the explicit `http://` URL in **Add addon** for this local service.
A `stremio://` opener may change it to HTTPS, which the local server does not serve.

An automatic port changes on restart. For a lasting installation, choose an
unused fixed port and reuse it:

```sh
uv run yomiru serve --port 8808
```

If that port is occupied, choose another. Do not stop an existing server.
The service binds only to `127.0.0.1`; TV/phone access is not supported.

## Background startup on macOS

Run once from the checkout after `uv sync --locked`:

```sh
uv run yomiru service install --port 8808
uv run yomiru service status
```

This creates Yomiru's own per-user launch agent. It runs at login, uses the current
Python environment and local library, and recovers if its process exits. The
default background display is rōmaji. It refuses an existing service configuration
or an occupied port; do not stop another service to make room. Add the printed
manifest URL to Stremio, or keep the existing installation if that URL is unchanged.
The Mac must be awake while its local add-on is in use.

For display/appearance options, use the foreground `serve` command instead.
The managed service currently uses the default appearance.

To remove only this checkout's matching service configuration and stop its job:

```sh
uv run yomiru service uninstall --port 8808
```

Use the same port supplied during installation. Generated subtitles and caches
are retained. A differing configuration is left untouched for manual review.

## Local library and release matching

The default library is `.local/library/`, ignored by Git. Use `--data-dir` on
both commands to select another directory. Do not put provider secrets or
downloaded subtitle files in tracked source.

`--release` is a case-insensitive substring required in Stremio's supplied
video filename. If the client omits that filename, release-filtered tracks are
not offered. Omit the flag only when you accept the **release not matched**
label and will check timing yourself. Track caching includes timing settings;
it does not align different editions.

Generated metadata records the video ID, type, mode, release hint and discovery
identity, with no local source file paths. Automatic tracks have a separate
provenance record containing provider names, source filenames and timing status.
The content hash includes output and settings, so changes produce a new track.
The sibling `discovery/` directory contains the anonymous provider response cache;
downloaded captions and archives stay outside tracked source.
