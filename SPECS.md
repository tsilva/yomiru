# Product intent

Help viewers learn Japanese while watching anime in Stremio, using a paired
Japanese learning line and an English or European Portuguese meaning line with
clearly different appearance.

## Established direction

- Support rōmaji, kana and original Japanese as the three Japanese displays. Kana
  combines hiragana readings with written katakana. Original Japanese preserves
  the source's spelling.
- Keep the learning line larger and pale yellow, with the smaller pale-blue target
  translation below, including English and European Portuguese (Portugal).
  Keep the two languages close together in every reading mode, including wrapped
  captions and both 4:3 and 16:9 canvases, without overlapping their regions.
  Preserve this layout in Stremio's Android ExoPlayer with ASS styling enabled.
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
When sending the full script in batches, keep the glossary and script in a
shared prompt prefix before the changing target IDs so the provider can cache it.
Use `yomiru translate` for administrative generation. Default to one worker
and one model request when the estimated output fits the safe model budget.
For split jobs, use contiguous cue ranges and independent forks from a shared
full-context warm-up. Allow explicit parallel generation and measure cache reuse,
elapsed time, and semantic cue fidelity before selecting a different default.
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

Automatically trace administrative subtitle generation to the dedicated Yomiru
Subtitles project once its upload route is configured. Record successful runs,
fully cached runs, and failures with timing and counts. Keep subtitle content,
prompts, generated translations, and error text out of telemetry. Send model
requests with `store: false`. Retain undelivered trace metadata for retry
without rerunning translation.

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
Publish catalogue, track and vocabulary changes incrementally for the affected
titles. Preserve saved links, subtitle and word IDs, and published vocabulary
when migrating the existing library. Keep the original Japanese subtitles and
versioned cue and token positions private and reusable across translations and
reading modes.
Keep private database inputs sufficient to regenerate an available language in
any supported reading mode and to reproduce published ASS byte for byte.
Retain legacy rendered timelines and their provenance when exact translation
pairs are unavailable. Generate and verify tracks before public serving.
Restrict uploads to the administrator. Public playback never runs translation
or language-model inference.
Serve the published ASS without an opening feedback card. Preserve dialogue,
styling, geometry, timing, and explicit positioning for Stremio playback.
Bootstrap Evangelion episodes 1 and 2, verify hosted discovery and serving, then
retire their local Stremio alternatives while retaining reconstruction evidence.

Offer **🦊 Yomiru** in Stremio Discover under Movies and Series. List titles
with active published subtitles from the same library as the website. New
publications update Discover and the website without an add-on release or
reinstall. Keep Cinemeta movie, series and episode IDs so Discover, regular
Stremio browsing and website play links share Continue Watching and watched
progress. Let Cinemeta provide the full title and episode details. Viewers play
through their existing stream add-ons and select Yomiru in the subtitle picker.
Retain source attribution, release compatibility and timing uncertainty in
published track metadata and compatibility records.

Publish English with rōmaji for the four Rebuild of Evangelion films. Use
standard Stremio movie IDs and identify the source cut for each track. List the
films together in a searchable, collapsible **Rebuild of Evangelion** group
alongside the shows, with direct Stremio movie links.

Publish English + rōmaji learning tracks with matching vocabulary for One Piece
films approved for release. Group them by Japanese theatrical release order.
Remove the retired standalone rōmaji files and links after the replacement is
live. Preserve the Japanese sources, vocabulary and earlier bilingual links.

Preserve original descriptive series and episode metadata in the published
library. Apply this automatically to every future show and episode through the
shared publication path. Reject publication when a covered episode lacks
matching source metadata or its title, and leave missing episode synopses empty.
Use Cinemeta as the shared source of descriptive movie, series and episode
metadata and standard Stremio IDs for the library and future anime catalogue.
Reuse verified Cinemeta entries between subtitle publications.

Build a catalogue of video versions seen in Stremio subtitle requests, using
available video hashes, file sizes and sanitized filenames. A request is evidence
that a source was seen, not proof of playback or selection of our subtitle.
Keep existing binary compatibility reports scoped to the video version and
subtitle revision. Zero votes mean unrated. These community reports do not
verify synchronization.

An existing subtitle feedback link opens a single read-only episode and subtitle track
with a 1–5 star rating, an optional comment and one submit action. The link
identifies the reading mode and translation where recorded. Keep one changeable
rating per browser and link. Keep comments private to the operator and leave
star ratings separate from binary compatibility totals. Omit episode, track
and video selectors. Omit feedback links from Stremio series and episode details.

Keep existing feedback links bound to the recorded subtitle revision and video
source. Opening a link leaves voting to the viewer.

Label the kana track “Yomiru - Kana” in the hosted subtitle picker. Use the fox
emoji and reading mode for the other tracks. List rōmaji first, followed by kana
and Japanese. Prefer tracks with a Japanese source anchor over legacy tracks
for the same episode, translation
language and reading mode. Preserve legacy files and saved links. Group hosted
learning tracks under their translation language in Stremio. Use English for Japanese + English
and Portuguese for Japanese + European Portuguese, keeping the Japanese learning
line in both. Stremio controls automatic selection.

## Future anime catalogue

Let viewers browse anime and request a Yomiru translation for a selected movie
or episode. Use the same Cinemeta entry for browsing, translation requests and
published subtitle coverage.

## Vocabulary catalogue

Help viewers learn the vocabulary they need before watching one episode,
several episodes or a whole show. Let them browse Japanese words with readings
and English meanings. In the Meaning column, show a short gloss with an “N more” control
beneath it that expands to a bullet list of the remaining meanings. Let learners
filter by grammatical category. Include each shared word once.
Search Japanese spellings and readings, including rōmaji for encountered forms
with known readings. Match meaning queries from the start of words in glosses.
Default to the most frequent words in the selection, using the sum of their
occurrences in those episodes.
Show each word's occurrence count across the episode selection as the sole
frequency measure. Omit ranks and frequency-type controls. Let learners sort by a
vocabulary data column and reverse its direction.
Place personal practice mastery first, with a compact bar and whole percentage
beneath it. Show “Not practiced” when the browser has no record for the word.
Place Category immediately before Frequency. Let learners sort the full filtered
selection by mastery in either direction. Calculate mastery from local practice
records by vocabulary ID and keep practice records and scores in the browser.
Keep mastery out of CSV exports.
Preserve stable IDs for future flashcard drills and Anki use.

Use the same versioned Japanese subtitle anchor for every translation of a
published episode, including European Portuguese (Portugal). Episode vocabulary
belongs to that Japanese source, independently of target language and reading
mode. Vocabulary browsing, search, coverage and export use English meanings
across all vocabulary-ready episodes. Adding or correcting a translation must
preserve the episode's Japanese word set. Changes to the Japanese source
require an explicit source revision.
The subtitle upload workflow prepares missing Japanese vocabulary from the
source cues for each new or revised movie or episode. Publish its tracks and
matching vocabulary together for all its video IDs. Preserve existing vocabulary
coverage and allow unchanged older tracks to remain available.
Show live vocabulary counts and study controls for starred episodes and movies.
Omit the CSV download action from the website. Prompt viewers to star a title
when they have no favorites. Save favorites in the browser across reloads,
search, pagination and gallery navigation.
Give each vocabulary-ready title an accessible star toggle. The group heading
has its own star for all vocabulary-ready titles in the group, including those
hidden by search or pagination. It reflects whether none, some or all titles
are starred. Individual titles remain independently removable from favorites.
Recover group state in place when the library updates during loading. Keep the
current search and favorites that still have published vocabulary.
Count distinct word IDs across all favorites in a single request.
Load study details on demand and make failures explicit.
In the word browser, reveal more results as learners scroll. On phones, fit
all five columns without horizontal scrolling.
Page catalogue searches and vocabulary results on the server. Precompute
all-title vocabulary totals in PostgreSQL as publications change. Keep
subtitle files and private source archives in object storage.
Use stable Japanese vocabulary IDs suitable for future Anki notes. Retain words
with missing English meanings and expose that gap instead of changing
the word count. Prepare vocabulary before publication; public serving performs
no tokenization or inference. See the [vocabulary guide](docs/vocabulary.md).

Maintain a shared master vocabulary registry: each Japanese lexeme owns its
readings, English meanings, resolution status and provenance once.
Episodes reference registry IDs and retain only their occurrences, forms and
source examples. Meaning corrections apply to every referencing episode without
regenerating subtitle tracks or episode vocabulary assets. Reuse resolved meanings
when publishing more episodes; preserve registry corrections through publication
and dictionary refresh. Missing or ambiguous meanings remain explicit rather
than being guessed or counted as resolved from a label alone.
Prepopulate the single shared dictionary from JMdict and record the original
entry ID when known. Keep existing vocabulary IDs and curated meanings. Publish
unresolved words with source examples, then review them in the background to
resolve supported meanings or correct tokenization. Uncertain results stay
unresolved. Background review never delays subtitle publication.

Cover reusable Japanese words in the published subtitles. Apply the same
eligible occurrences to word browsing, selection counts and CSV exports. Use
those occurrences as the source for practice eligibility. Exclude uses as proper
names and title-specific named entities, raw digit strings, isolated Latin letters, non-lexical sounds and
tokenization debris. Keep ordinary uses of the same spelling, Japanese number
words and counters, conventional interjections and mimetic words. Keep genuine
words with unresolved meanings visible and exportable. Matching practice
requires a usable reading and meaning. Preserve subtitle cues and existing IDs
for surviving words. Use source context to review ambiguous tokens and apply
exclusions to the affected occurrences only. Phrase search and standalone
flashcards are future work.

## Vocabulary practice

Place Exercise to the left of Browse words in the subtitle library for
starred episodes and movies. Use frequency-based training from this button.
Place Practice next to Open in Stremio in the selected title's action bar.
Practice just that episode or movie in subtitle order while preserving favorites. Advance through eligible
words by their first occurrence. Interleave a ready retry after two new prompts,
prioritizing misses, and give each retry at least two intervening prompts while
new words remain. Queue low-mastery words, misses, and skips. Clear a word from the
session’s retry queue after two correct answers without help on separate turns.
Finish the remaining retries that are ready at the end of the title. Use the same persistent
mastery and delayed-review rules in both modes. While practice opens, center the
Yomiru fox revealing Japanese and English subtitles above the loading status.
Place the fox and its soft glow directly on the screen background.
Animate the fox and loading dots unless reduced motion is enabled.

In episode practice, replace the mastery bar with a scrubber when subtitle
timing is available. Keep mastery and the mastered count as text. Show the
current subtitle time and the duration of the subtitle timeline. Preview the
nearest available quiz subtitle's time on hover or drag, and jump on click or
release. Support keyboard navigation and preserve mastery and pending retries
when jumping.

Open the meaning quiz by default. Show a Japanese subtitle line with the target
word highlighted and four shuffled English choices. Prefer distractors from the same part of
speech and exclude other valid meanings of the prompt. On desktop, 1–4 select
an answer directly. Keep the answer buttons at the bottom of the viewport and
center the full kana and rōmaji prompt vertically between them and the header.
On mobile, entering Exercise requests fullscreen and portrait orientation when
the browser permits them. Return to the previous display mode when leaving.
On phones, place Library, Practice and Combo in one row above the mastery
summary. Use a two-by-two answer grid on narrow screens and a single row on
short screens with enough width. On short screens, tighten the spacing and
compact the controls to fit the full subtitle and four answers together. Keep
both scripts readable and let long text wrap. If the contents still exceed the
viewport at an extreme size or text zoom, let the whole screen scroll. Lock the choices
after the first answer. Play a short chime and
show green feedback on a correct answer. On a miss, mark the chosen answer red,
reveal the correct one in green, and schedule the missed word for another attempt
later. Advance after feedback.
Exclude particles from practice prompts, answer choices and mastery totals.
Retain their occurrences and meanings for in-phrase lookup.

Show the source line in mixed kana with smaller
rōmaji below. Highlight the target form in both lines. Use the same English
choices, word ID and review schedule. In frequency-based training, rotate suitable
examples when alternatives exist. In subtitle order, prefer the first-occurrence cue
and use the earliest suitable cue when it cannot be shown. Reuse that cue for
retries until its translation has been revealed. Use a different subtitle line
for scored retries after a reveal, or wait until delayed review if none is
available.
Skip target words without usable context. Draw examples from the same titles as the word pool.
Exclude examples from an older Japanese source revision.

Let learners peek at the English dictionary meaning of other words in the
contextual prompt when aligned readings and meanings are available. Include
proper names with a JMdict match for the spelling and reading. Hovering or
focusing a word highlights it in both kana and rōmaji. Activating either
spelling opens the tooltip and silently resets the combo. Keep the tested word
unavailable for peeking throughout the line. Learners can still answer, and an
assisted answer earns no combo increment.

In episode practice, advance automatically after answer feedback. Let learners
toggle the published English translation for the current cue. Keep the word
lookups available while English is visible. A translation revealed before
answering makes the answer ineligible for credit. Revealing it after an answer
preserves the credit already earned.

Retain matching as a separate game that can be enabled in code. Hide matching
from the public interface for now.
In matching, use kana with rōmaji on the Japanese tiles and English meanings
on the answer tiles. Let
learners select a tile in either language first. Play a short chime on correct
matches. Show brief green feedback, then fade the matched tiles out over 1.8
seconds. On a miss, turn both selected tiles red and fade
their color back to normal over 1.8 seconds, keeping them in their slots.
Block input on tiles showing feedback and keep the remaining tiles playable
during the fade. On desktop, use number keys 1–4 to select a Japanese tile,
then use 1–4 again to select its English match. Show shortcut labels only on
the row that accepts the next number key. Escape clears any selection and
always keeps practice open.
On mobile, use up to six rows with equal visible gaps between tiles. Give
accepted tile taps brief haptic feedback where the browser supports it.
Mix familiar words, due reviews, and gradually introduced difficult or unseen
words. Prefer frequent content words on opening boards. Introduce auxiliaries,
affixes and interjections later, while allowing due grammar reviews
after the opening content words. If a board rebuild removes an unresolved missed
pair, skip it on the immediate refill and prioritize it once four other
attempts have passed. Allow an earlier return after at least one other attempt
when too few distinct pairs are available.

Save one mastery record per stable vocabulary ID in the browser. Carry it
across selections and games and count each playable word once in the selection mastery
calculation, including words outside the loaded practice batches. Load cards
for upcoming rounds on demand. Load catalogue and vocabulary details when a
viewer needs them. Keep review scores and scheduling in the browser.
Show mastery for the starred titles beside the unique-word count in the subtitle library.
Use a compact bar and percentage for each episode or film and for its full
group, including in the cover gallery. Group scores include playable words in titles
outside the visible search or page. Average each distinct playable word once
within its scope.
Display mastery to two decimal places alongside the mastered count
and total playable word count for the selection. Count a word as mastered once
it reaches the final delayed-review stage with its current reading and meaning.
A meaningful correct answer raises the score up to 100, including on the first
day. Decay the score with time away and weaken decay after successful delayed
reviews. An occasional miss can shorten the review interval while
preserving prior evidence. Count consecutive first-try successes in the combo.
Pulse the combo number on a success and flash it gold with three sparks at
multiples of five. Place the Yomiru logo fox beside the counter, with its
closed, arched eyes, paws and two subtitle bars. Give the fox a subtle breathing
loop while idle. The fox winks on a combo-earning answer and leans with a small
heart on a miss. Celebrate combos of five, ten and fifteen with a double hop, a
dance and a crown. The crown stays for the rest of the streak. The fox returns
to its idle animation on a silent reset from a peek. Keep feedback in the
counter area and respect reduced motion.

## Delivery boundary

Publish a minimal public landing page at `yomiru.tsilva.eu`, using the approved
cinematic layout, Stremio's dark palette and violet accent, Yomiru branding,
one subtitle preview and one install action. Place a circular, icon-only GitHub
repository link in the upper-right corner. Fill the viewport with artwork
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
Keep the manual URL in that guide and omit additional hero navigation and feature
sections. Preserve the stable manifest URL so published subtitle and server
updates reach existing installations.
Require portrait orientation on mobile. If the device enters landscape, show a
full-screen rotate-device prompt with a phone rotation icon and resume the
current screen when it returns to portrait.
Allow viewers to install the website from Chrome on Android and open it from
the home screen without the browser address bar. Keep web app installation
in the browser menu with a separate manifest from the Stremio add-on.
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

Place the searchable subtitle library below the landing hero with the approved
blue fade and full-width search. Show series and film collections as a cover
gallery. Open one group at a time in the same section, with a matching gallery of
published episodes or movies and a way back to all groups. Use original Yomiru
covers and original widescreen illustrations based on individual episodes. Keep
the episode code and title visible below the art. Use numbered placeholders for
episodes without art and portrait cards for movies, with cover placeholders where
needed. Keep artwork display independent of Stremio identity and subtitle availability.

Select a card to update one shared action bar with the selected title's
translations, mastery, favorite, Practice and Open in Stremio controls. Keep
group favorites and mastery accessible in the group gallery. Use season and
episode order with codes such as S01E01. Use stable movie codes such as M01
assigned across the full group before filtering or pagination. Keep Rebuild of
Evangelion, One Piece Movies and Other Movies separate. Fit all controls without
horizontal scrolling.

Search by group name, title, code or translation across the published library.
Show matching groups and titles, and load more as the viewer approaches the page
bottom. Show only published availability and retain timing uncertainty in
subtitle or source details. The secondary **Browse subtitles** link scrolls to
the library and respects reduced motion. Preserve the full-viewport landing hero.

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
