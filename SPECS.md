# Product intent

Help viewers learn Japanese while watching anime in Stremio, using a paired
Japanese learning line and an English or European Portuguese meaning line with
clearly different appearance.

## Established direction

- Support rōmaji, hiragana, katakana and original Japanese display. Original
  Japanese preserves the source's mixed kanji/kana rather than forcing all-kanji text.
- Keep the learning line larger and pale yellow, with the smaller pale-blue target
  translation below, including English and European Portuguese (Portugal).
  Keep the two languages close together in every reading mode, including wrapped
  captions and both 4:3 and 16:9 canvases, without overlapping their regions.
- Deliver styled ASS through a Stremio subtitle add-on; avoid per-episode file dragging
  in the eventual routine workflow.
- Preserve supplied source cue times unless timing adjustment is requested, and
  account for the chosen video release. A caption
  comparison is not a listening verification or a guarantee of word-level accuracy.
- Keep pronunciation corrections and provider coverage explicit. Missing Japanese
  subtitles must not be replaced with Japanese invented from an English translation.

## Automatic discovery

Starting an episode should offer Yomiru in Stremio's subtitle picker without
per-episode file downloads or dragging. Discover real Japanese and English
captions for the requested episode, then generate and cache the selected display
mode. Retain the manual-file workflow for missing coverage or corrected captions.

Coverage depends on upstream sources. Missing captions, provider failures and
ambiguous episode numbering must remain explicit; do not substitute a different
episode or claim universal availability. Preserve release uncertainty in labels.

## Source selection in Stremio

Implement Yomiru as a Stremio add-on with no browser extension installation.
Users select a source-specific Yomiru entry from Stremio's subtitle picker to
receive the Japanese learning line above that source in styled ASS. Keep source
choices explicit and preserve the selected source; failed downloads must not
silently substitute another track. Ordinary subtitles remain selectable when
the user does not want Yomiru.

The add-on API does not expose another add-on's selected track. Yomiru must serve
its own combined track rather than claim to intercept arbitrary player selections.
Keep provider/embedded-track coverage and timing limitations explicit. Retain
manual file composition for sources that discovery does not provide.

## Relative caption timing

Reduce small timing gaps between discovered Japanese and base captions when
there is consistent evidence across the caption timeline. Keep the chosen base
timeline as the reference; leave uncertain or changing offsets untouched. Support
nearby boundary alignment for clear one-to-one cue matches after a reliable fit,
preserving the text and distinct segmentation of other cues. Support
independent manual delays and an option to retain source timing. Record applied
adjustments and retain source files. Caption alignment is not audio verification
and must not claim to correct different edits or translation segmentation.

## Japanese-anchor translation experiment

Evaluate an optional AI translation pipeline independently of Stremio. Use real
Japanese subtitle anchors; generate only the target-language text and let code
retain cue identity/timestamps for both displayed languages. Compare low-cost
OpenRouter candidates on semantic quality, cue coverage and measured performance
before selecting a model. Keep validation distinct from translation accuracy.
Keep translated meaning within its own Japanese cue, preferring faithful fragments
over moving phrases to neighboring cues for smoother English word order.
The intended routine workflow must be fully automatic: episode-specific editorial
corrections are not a solution. Compare stronger models using unedited outputs,
keeping evaluation references separate from translation inputs.
For the next iteration, use Codex models through AgentBridge before further
OpenRouter trials. Compare prompts, context, batching, reasoning levels and
available Sol/Terra variants, prioritizing semantic and cue alignment accuracy
before measured throughput. Keep development checks separate from an untuned
evaluation sample; report the best tested configuration rather than claiming
universal optimality.
Prefer a single model and one zero-shot generation pass for the intended
translation workflow. Evaluate whole-episode output against batched output;
do not assume output batching is needed for context or that a separate reviewer
is required. Keep the full Japanese script available when the chosen model's
input limits allow it, while preserving each cue's own meaning and timestamps.
Reuse translations by exact subtitle content, language, prompt and model version.
Use reviewed corrected subtitles as a frozen evaluation reference, never as English
examples or drafts supplied to generation. Default new administrative subtitle
generation to AgentBridge `codex/gpt-6.2-sol` with `low` reasoning. Specify a model
and reasoning level explicitly for controlled comparisons. Compare generic prompts
and reasoning levels on a whole episode, confirm promising settings with repeats
and additional material, and compare semantic quality with token and time efficiency.
Report observed errors and ambiguity rather than claiming perfect accuracy or treating stylistic
paraphrases as failures. Keep account-backed token usage separate from unavailable
monetary cost.
Experimental inputs should retain original Japanese reading and speaker annotations
as context, while translating only the cleaned dialogue. Benchmark context
compression against fidelity. Future model comparisons should use inexpensive
diagnostics to shortlist candidates, followed by whole-source confirmation on
untouched material; keep screening metrics separate from production results.
Prefer the accepted lean pilot representation: send each original annotated
Japanese cue once and return one `id|English` line per cue, retaining exact source
ID order and timestamps in code. Accept its documented residual quality tradeoff
for measured token/time savings; keep known errors visible rather than treating
the observed cue counts as a population accuracy estimate.

Build a subtitle-quality flywheel: preserve original generated versions, audit
against Japanese and context, save supported corrections separately, and promote
confirmed error patterns into a versioned regression suite. Judge semantic
equivalence and cue ownership, accepting equally accurate paraphrases. Keep
uncertain findings separate from confirmed failures; reference English remains
evaluation-only. Compare repeated runs for finalist changes, retaining known
baseline failures and exposing new regressions. See
[subtitle quality workflow](docs/subtitle-quality.md).

Administrators may bootstrap the shared library using Codex through their own
AgentBridge account route. Generation remains separate from public serving.

## Published subtitle library

Serve administrator-published, complete learning tracks through a public HTTPS
Stremio add-on. Viewers need no local process, provider key or AgentBridge setup.
Keep generation under Yomiru's administrative control; user-generated uploads
and user-supplied inference credentials are outside the initial delivery.
Publish only complete validated episodes with explicit source attribution and
release/timing uncertainty. Structural validation does not certify translation
accuracy or synchronization with audio. Preserve immutable track revisions and
existing coverage when adding episodes or updating the website. Keep downloaded
sources, translation traces and generated subtitle files outside tracked source.
Maintain a private subtitle provenance registry by episode and revision. Record
the source of the Japanese dialogue and timing, the origin of the English text,
and the references consulted for each revision. Identify the output as a Yomiru
learning track and describe how each source contributed.
Serve the web app on Vercel. Store published track files in Cloudflare R2 and
query the catalogue, track revisions, vocabulary, and compatibility data in Neon.
An administrator can add complete episodes without rebuilding or redeploying the
website. Verify immutable assets before atomically activating the matching
library revision. Preserve existing Stremio URLs and published coverage.
Restrict uploads to the administrator. Public playback never runs translation
or language-model inference.
Serving may deterministically compose and cache the published ASS with a feedback
card; preserve the original dialogue, styling, geometry and timing.
Bootstrap Evangelion episodes 1 and 2, verify hosted discovery and serving, then
retire their local Stremio alternatives while retaining reconstruction evidence.

Offer Yomiru as a subtitle-only Stremio add-on. Viewers find shows through their
usual Stremio catalogues and play episodes through their existing stream add-ons.
Serve tracks against standard episode identities. List published coverage on
Yomiru's website and link each episode to its standard Stremio entry. Retain
source attribution, release compatibility and timing uncertainty in published
track metadata and compatibility records.

Preserve original descriptive series and episode metadata in the published
library. Apply this automatically to every future show and episode through the
shared publication path. Reject publication when a covered episode lacks
matching source metadata or its title, and leave missing episode synopses empty.

Build a catalogue of video versions seen in Stremio subtitle requests, using
available video hashes, file sizes and sanitized filenames. A request is evidence
that a source was seen, not proof of playback or selection of our subtitle.
Keep existing binary compatibility reports scoped to the video version and
subtitle revision. Zero votes mean unrated. These community reports do not
verify synchronization.

The subtitle feedback card opens a single read-only episode and subtitle track
with a 1–5 star rating, an optional comment and one submit action. The link
identifies the reading mode and translation where recorded. Keep one changeable
rating per browser and link. Keep comments private to the operator and leave
star ratings separate from binary compatibility totals. Omit episode, track
and video selectors. Omit feedback links from Stremio series and episode details.

Show a feedback card at 00:00–00:03 in hosted subtitle tracks, replayable by
seeking back. Use “Scan code or visit the URL to rate these subtitles.” as the
sole instruction, with Yomiru branding, a real QR code and a short HTTPS destination.
Keep the card compact and centered, with a blue URL and a QR code proportioned
for easy scanning. Keep the card clear of dialogue that starts in the same window.
Omit the episode/source footer. Bind feedback to the subtitle revision and to
the video source when Stremio supplies it.
ASS links are not clickable; scanning or typing opens the feedback page, without
casting a vote.

Use only the fox emoji and reading mode in each subtitle picker label. List
rōmaji first, followed by hiragana, katakana and Japanese. Group hosted learning tracks
under their translation language in Stremio. Use English for Japanese + English
and Portuguese for Japanese + European Portuguese, keeping the Japanese learning
line in both. Stremio controls automatic selection.

## Vocabulary catalogue and export direction

Help viewers learn the vocabulary they need before watching one episode,
several episodes or a whole show. Let them browse Japanese words with readings
and English meanings and download the full selection as CSV for
flashcards. Show one short gloss with access to the remaining meanings, and
let learners filter by grammatical category. Include each shared word once.
Search Japanese spellings and readings, including rōmaji for encountered forms
with known readings. Match meaning queries from the start of words in glosses.
Default to the most frequent words in the selection, using the sum of their
occurrences in those episodes.
Offer separate written and spoken Japanese frequency sorts based on named corpora
with terms that allow Yomiru to redistribute the rankings.
Show each word's rank for the active sort and its occurrence count across
the episode selection. Keep ranks stable when searching or filtering by category.
Keep unmatched words visible after ranked words and apply the chosen order
to CSV exports.
Preserve stable IDs for future flashcard drills and Anki use.

Use the same versioned Japanese subtitle anchor for every translation of a
published episode, including European Portuguese (Portugal). Episode vocabulary
belongs to that Japanese source, independently of target language and reading
mode. Vocabulary browsing, search, coverage and export use English meanings
across all vocabulary-ready episodes. Adding or correcting a translation must
preserve the episode's Japanese word set. Changes to the Japanese source
require an explicit source revision.
Show the live unique-word count, word browser and CSV controls by default.
Use all vocabulary-ready episodes when no episode is checked. Checking episodes
narrows the count, browser and export to those episodes.
Preserve selection across search, pagination and show collapse.
Place a select-all checkbox with an accessible name and no visible text label
above each show's episode checkboxes. It covers the full vocabulary-ready
episode set, including episodes hidden by search or pagination. Individual
episodes remain independently deselectable. The show
checkbox reflects whether none, some or all episodes are selected.
Count distinct word IDs across the complete selection in a single request.
Load study and export details on demand and make failures explicit.
In the word browser, reveal more results as learners scroll and place the
icon-only CSV download in the upper-right corner.
Use stable Japanese vocabulary IDs suitable for future Anki notes. Retain words
with missing English meanings and expose that gap instead of changing
the word count. Prepare vocabulary before publication; public serving performs
no tokenization or inference. See [vocabulary exports](docs/vocabulary.md).

Maintain a shared master vocabulary registry: each Japanese lexeme owns its
readings, English meanings, resolution status and provenance once.
Episodes reference registry IDs and retain only their occurrences, forms and
source examples. Meaning corrections apply to every referencing episode without
regenerating subtitle tracks or episode vocabulary assets. Reuse resolved meanings
when publishing more episodes; preserve registry corrections through publication
and dictionary refresh. Missing or ambiguous meanings remain explicit rather
than being guessed or counted as resolved from a label alone.

Cover every analyzed word in the published subtitles. Broader dictionary
coverage and flashcard drills are future work.
Exclude raw digit strings and isolated Latin-letter tokens from vocabulary
browsing, counts and CSV exports. Keep Japanese number words and counters.

## Delivery boundary

Publish a minimal public landing page at `yomiru.tsilva.eu`, using the approved
cinematic layout, Stremio's dark palette and violet accent, Yomiru branding,
one subtitle preview and one install action. Fill the viewport with artwork
behind the logo and copy, including on portrait screens. Use a subtle dark
overlay to emphasize the headline and install action. Artwork should feel
calm and welcoming, with people clearly away from railway
tracks and unprotected edges. Keep the desktop and portrait artwork free of
baked-in captions. Render the subtitle example as responsive HTML/CSS, with a
larger pale-yellow Japanese reading above smaller pale-blue English. Play an
ordered scene sequence with natural cue durations and minimal gaps between
pairs, including the loop restart. Begin with “Koko wa ochitsuku ne.” /
“It’s peaceful here, isn’t it?” Provide a desktop pause control and hide it on
mobile. Pause in hidden tabs and show a static first cue for reduced motion.
Pause the preview while the installation modal is visible, then resume from the
same position unless manually paused.
The scene preview is staged dialogue;
do not claim it is synchronized to recorded audio.
The main install button opens the numbered installation guide, with no separate
installation-help link. The install button inside the modal opens the hosted
add-on in Stremio, with its Yomiru icon; Stremio controls installation confirmation.
Keep the manual URL in that guide rather than adding navigation or feature sections. Preserve the stable
manifest URL so published subtitle and server updates reach existing installations.
Do not claim the add-on can force Stremio to refresh saved manifest metadata.
Installation help presents numbered steps: click the button below to install the
Yomiru add-on in Stremio and confirm installation in the app,
enable ASS styling as step 2, open an episode from a regular Stremio catalogue,
choose the translation language in the subtitle picker, then select a Yomiru
track.
Place a direct Stremio button within the guide and a light circular × close
control overlapping the upper-left corner outside the dialog bounds, without
an empty header row or automatic button highlight.
Preserve keyboard focus visibility and omit “Coverage is growing”.

Place a compact searchable subtitle library below the landing hero, without a
separate header or navigation. Use a full-width search field and collapsible show
groups, expanded initially. Within each show, use separate Episode, Title and
Translations columns with an action to open the episode in Stremio. On narrow
screens, reflow each row so all fields and controls fit without horizontal
scrolling. Display zero-padded episode codes such as S01E01 and S02E02. Sort
numerically by season, then episode, without separate season groups. Search covers show names, episode
titles and episode codes and automatically reveals matching groups, including
previously collapsed shows. Omit the search helper text, timing column and
reading-mode selector.
Load additional rows automatically as the viewer approaches the page bottom;
search covers the published library, not just the rows already loaded.
Show available translations from Japanese into target languages independently
of Japanese reading modes. Original Japanese retains its mixed kanji/kana;
rōmaji, hiragana and katakana are derived displays, not separate translations.
Show only actual published coverage. Omit aggregate counts and catalogue footer
notes; preserve timing uncertainty in subtitle/source details outside this table.
Add a secondary “Browse subtitles” anchor beneath the hero's install action to
scroll to the library; respect reduced-motion preferences.
Omit catalogue media artwork unless Yomiru
need neither scrape nor host it. This section is the exception to the minimal
landing page's exclusion of additional sections; preserve the hero above it.

The install button has a raised violet face, a centered label and no arrow.
Its face visibly depresses while pressed with mouse, touch or keyboard.

Keep the local subtitle add-on available for manual/offline work. Synthetic
examples provide a reproducible offline result. Downloaded episode content is
not bundled in source.

Offer persistent local startup so watching does not depend on an active chat or
terminal session. Preserve unrelated processes and service configurations.

Stronger release matching and per-show reading corrections remain future work.
No specific upstream provider or
hosting platform is a permanent commitment.
