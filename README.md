<p align="center">
  <img src="logo.png" alt="Yomiru" width="320" /><br />
  <!-- repo-tagline:start -->
  <strong>📺 Learn Japanese through anime subtitles 🌸</strong>
  <!-- repo-tagline:end -->
</p>

Yomiru pairs Japanese learning subtitles with English meaning in Stremio.
The learning line is larger and pale yellow; English appears below in pale blue.
Choose rōmaji, hiragana, katakana or the original mix of kanji and kana.

Start a supported episode and select **Yomiru** in the subtitle picker. The
hosted add-on serves prepared tracks from an administrator-managed library.
The name combines *yomu* (read) and *miru* (watch).

## Try it

Open [Yomiru](https://yomiru.tsilva.eu), choose **Install in Stremio**, then select
a **Yomiru** track on a supported episode. Alternatively, paste
`https://yomiru.tsilva.eu/manifest.json` into **Addons → Add addon** in Stremio.
Enable **Style ASS subtitles** to preserve the colours and sizes. No local server
or inference account is needed. Initial hosted coverage is Evangelion episodes
1 and 2; timing remains unverified for other video releases.

The [local discovery and manual-file workflows](docs/usage.md#automatic-discovery)
remain available using Python 3.11+ and [uv](https://docs.astral.sh/uv/).

Yomiru is a **Stremio add-on**. Its subtitle entries identify the chosen base
source and Japanese source, so you can select a combined version inside Stremio.
See [choosing a source](docs/usage.md#choosing-a-source-in-stremio). Select an
ordinary subtitle entry whenever you do not want the Japanese learning line.

## What works

- Discover captions through Kitsunekko and Stremio's OpenSubtitles v3 add-on,
  including episode files inside ZIP archives. No API key is required.
- Choose `romaji`, `hiragana`, `katakana` or `japanese` display.
- Reduce a consistent timing gap between discovered Japanese and base captions,
  and combine overlapping dialogue. Uncertain offsets are left unchanged.
- Cache tracks separately by episode, display mode, appearance and release hint.
- Serve prepared tracks over HTTPS, with all four Japanese display modes.
- Prepare and upload complete episodes through an
  [administrator publication workflow](docs/publishing.md).
- Retain a loopback-only add-on for local discovery and manual files.
- Choose a source-specific merged track directly in Stremio's subtitle picker.
  A failed source download never silently switches to another track.
- Use your own SRT/ASS files when an episode is missing or needs corrections;
  an [offline synthetic example](docs/usage.md#build-and-watch-a-track) is included.

Pronunciation conversion is dictionary-based and can misread names or ambiguous
kanji. The `japanese` mode preserves source spelling; it does not convert every
word into kanji. Fonts and ASS support depend on the playback device.

Automatic discovery checks episode identity and ranks Japanese files using the
stream filename when supplied. It can shift Japanese captions against the base
track when caption starts consistently support one small offset. It does not
listen to audio or align different edits. It also lines up nearby start/end times
for clear one-to-one cues after a reliable timing fit. English and Japanese may differ in segmentation and
word order. Manual release hints are filename filters, not synchronization proof.

Yomiru does not fetch video, translate English into Japanese, transcribe audio,
manage Stremio credentials or bundle downloaded anime subtitles. An optional
[macOS background service](docs/usage.md#background-startup-on-macos) keeps the
local add-on running. Hosted library access works independently of that service;
authenticated source providers are not implemented.

Read [product intent](SPECS.md) and the [development guide](docs/development.md)
for the delivery boundary and provider integration details.

An optional [standalone AI translation trial](docs/translation-trial.md) explores
translating Japanese anchors while retaining one shared subtitle timeline. It is
separate from public serving and includes an offline structural check. Inspected
complete outputs can be published through the administrator workflow.

## License

[MIT](LICENSE). Example captions are original synthetic material. Third-party
subtitle files and dependency assets retain their own terms.
