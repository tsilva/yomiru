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
For new bilingual tracks, review every cue against the exact Japanese source
and paired translation before activation. For English Practice, review both
scored and excluded spans, keeping full contextual expressions and checking
readings, meanings, alternatives, and credited vocabulary separately. Preserve
the reviewed questions with their release inputs and replay every question
before activation and against the published exercise. Render the release files
from the stored cues. Reuse the provisioned publisher for successive episodes
without per-episode credentials or setup.
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
Default to the most frequent introduced words in the published subtitle library.
Show each word's occurrence count across the published subtitles as the sole
frequency measure. Omit ranks and frequency-type controls. Let learners sort by a
vocabulary data column and reverse its direction.
Place personal practice mastery first, with a ring around the whole percentage.
Show an em dash when there is no mastery score.
Show a compact countdown such as “in 9h45m” beside Mastery, using
the browser's saved practice schedule. Place Category immediately before
Frequency. Let learners sort the full filtered selection by mastery or next
review in either direction. Calculate both from local practice records by
vocabulary ID. Keep personal practice data in the
browser and out of CSV exports.
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
Build the global vocabulary from distinct words presented as meaning questions
in Practice in this browser. Include words as soon as the question appears,
including unanswered questions. Keep this history across reloads, search,
pagination and gallery navigation. Show its word count and average mastery,
counting words without recall credit as zero. Disable Browse words when the
history is empty and prompt viewers to start Practice. Keep Review available.
Omit title and group stars and the website CSV download action. Load study
details on demand and make failures explicit.
In the word browser, reveal more results as learners scroll. On phones, fit
all six columns without horizontal scrolling.
Page catalogue searches on the server and fetch dictionary details for personal vocabulary in bounded batches. Precompute
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

Place Review to the left of Browse words in the subtitle library and keep it
available from the library. Mix meaning questions and verb conjugations in
one round across titles. Use words introduced in Practice, including unanswered
questions. Include individual verb forms the learner has answered in this
browser, including first-attempt misses. Interleave the
two question types, starting with due items and ordering each type by its
schedule. Allow another round as soon as a learner finishes, including on the
same day. Extra practice before the scheduled time keeps the existing review
date and mastery credit. For meaning questions, use approved reviewed subtitle
occurrences and highlight the form used in the cue. Match the saved contextual
meaning when available. Prefer a different episode for
that meaning, then a different cue in the same episode. Use all published
titles with current reviewed Practice data. Skip words without a matching
example. Show four prepared English choices and hide the English subtitle.
Use the existing word ID and review schedule for meaning questions. Grade the
first selection and use the episode quiz’s feedback and retry behavior for
both question types. On completion, show the Yomiru fox, count the reviewed
questions and offer Review again. Keep the Library navigation and use a
neutral empty state when no questions are available.

Offer a separate Verb Trainer action for each episode alongside Practice.
Use the episode’s actual verb occurrences and introduce verbs by frequency,
mixed with forms due for recall. Prepare supported modern verb forms and the
four choices before serving them, linked through the shared vocabulary.
Raise the written Japanese, kana, rōmaji, and English meaning together above
the form label. Place the label just above the four Practice answer tiles.
Show the dictionary verb group beside the prompt. Put a question-mark button
beside every form label in Verb Trainer and Review. Its short guide explains
when to use the form and how to build it for Godan, Ichidan, and Irregular
verbs. Write Japanese sounds and endings in rōmaji and use rules that apply
without giving the current verb’s answer.
Show written Japanese, kana and rōmaji on each tile. When the written form
matches the kana, show it once with rōmaji underneath. Keep conjugation
mastery and review dates per vocabulary ID and form. Meaning questions affect
the verb’s vocabulary mastery and conjugation questions affect the queried form.

Place Practice in the selected title’s action bar and study only that title.
Enable Practice only when the title has a current reviewed exercise. Otherwise,
show the disabled action with an explanation on hover and keyboard focus. Keep
subtitles available. Give supported episodes a shareable Practice URL under the
series and episode slugs. Opening or reloading that URL starts the same exercise.
In episode Practice, start with the first playable subtitle and follow subtitle
order. Within each phrase, highlight and quiz each eligible word occurrence
from first to last, including repeated words. Advance to the next phrase only
after the learner answers every eligible word in the current phrase correctly.
Share persistent mastery and delayed-review rules between Review and Practice.
Score only the prepared occurrences.
Parse every source cue and retain each vocabulary occurrence, including
repetitions. Record unresolved spans, missing meanings and grammar or source
exclusions explicitly. Keep episode coverage independent of session pacing.
Highlight the full inflected form when quizzing a verb and use the meaning
that fits that occurrence. Prepare the answer and alternatives before serving.
Credit the existing dictionary word ID. Pair the English line to the source
cue ID, and count each distinct playable word in the prepared episode once in
the episode's Practice mastery total.
When preparing Practice, consider the longest plausible source span and use
the Japanese and paired English to resolve its meaning and credited entry.
Keep shorter alternatives available when they represent independent words.
Save reviewed matches privately for reuse. Treat suggested and reused matches
as pending until the new episode review is complete.
While practice opens, center the Yomiru fox revealing Japanese and English
subtitles above the loading status. Place the fox and its soft glow directly on
the screen background. Animate the fox and loading dots unless reduced motion
is enabled.

In episode practice, show the current subtitle time and total duration beside
a read-only progress bar when timing is available. Keep mastery and the mastered
count visible as text.

Open the meaning quiz by default. Show a Japanese subtitle line with the target
word highlighted and two to four shuffled English choices. Prefer distractors
from the same part of speech and exclude other valid meanings. On desktop, 1–4 select
an answer directly. Keep the answer buttons at the bottom of the viewport and
center the full subtitle prompt vertically between them and the header.
On mobile, entering Review requests fullscreen and portrait orientation when
the browser permits them. Return to the previous display mode when leaving.
Place Library, Practice and Combo in one compact row. For a title-specific
session, show the series name, episode code and episode title, or just the
film title. Keep this next to mastery when there is room and above it on
phones. Keep the mobile controls below the display cutout, including in
fullscreen browsers that do not expose a safe-area inset. Use a two-by-two
answer grid on narrow screens and a single row on
short screens with enough width. On short screens, tighten the spacing and
compact the controls to fit the full subtitle and four answers together. Keep
all readings legible and let long text wrap. If the contents still exceed the
viewport at an extreme size or text zoom, let the whole screen scroll. Lock the
choices during feedback. Play a short chime and show green feedback on a correct
answer, then advance. On a miss, mark just the selected answer red and retry the
same word without revealing the correct answer. Use the first attempt at each
occurrence for mastery and combo credit.
Exclude particles from practice prompts, answer choices and mastery totals.
Retain their occurrences and meanings for in-phrase lookup.

Use mixed kana as the main reading, with smaller rōmaji and the full published
English translation below it. Show a small, gray original Japanese line close
above the kana when the source spelling is available. Highlight the target
in the kana, rōmaji and aligned original Japanese.
Keep English visible during ordinary questions as the learner moves through the
phrase.
Showing the phrase translation is part of the normal quiz and preserves
eligibility for credit. Indicate when a verified English line is unavailable.
Skip words without an aligned reading or usable meaning and exclude cues from
older Japanese source revisions.

Let learners peek at the English dictionary meaning of other words in the
contextual prompt when aligned readings and meanings are available. Show an
aligned compound as a single peek even when its reading spans multiple tokens.
Include proper names with a JMdict match for the spelling and reading. Hovering or
focusing a word highlights it in both kana and rōmaji. Activating either
spelling opens a tooltip anchored to the rōmaji word and silently resets the
combo. Show the dictionary kanji spelling when available and separate it from
the phrase's kana and rōmaji with middle dots. Put the English gloss on its
own row. Below it, show the part of speech and the dictionary conjugation
class for verbs when available, alongside the word's personal mastery
percentage or “Not practiced”. Particles show no mastery.
Keep the tested word unavailable for peeking throughout the line.
Learners can still answer, and an assisted answer earns no combo increment.

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
Show global mastery beside the count of words introduced in Practice.
Use a compact bar and percentage in the selected episode or film's details.
Place mastery along the bottom of group covers, episode artwork, and movie
posters. Reveal each card's exact percentage on hover or keyboard focus. On
phones, show group mastery in the opened group's details and title mastery in
the selected episode or movie's action bar. Group scores include playable words
in titles outside the visible search or page. Average each distinct playable
word once within its scope.
Display mastery to two decimal places alongside the mastered count
and total playable word count for the selection. Score each word for
estimated meaning recall in seven days without more practice. A meaningful
first correct answer gives visible early progress. Repeated answers in the
regular quiz give practice and combo feedback without postponing a scheduled
review. Base the review's mastery credit on the actual time since the learner
was last quizzed on the word across episodes. In episode Practice, a due word's
first question doubles as its delayed review. Keep subtitle order, show the
choices immediately, and hide the English subtitle and
word lookups for that question. Grade the first selection and let learners retry
a miss before advancing.
Count a word as mastered once it reaches the final delayed-review stage
with its current reading and meaning. Decay the score with time away
and weaken decay after successful delayed reviews. A missed review can
shorten the review interval while preserving prior evidence.
Show a temporary notification with the word's spelling, kana, contextual
English and current mastery after a first-try correct answer. For any saved
mastery change, show both scores and animate the bar from the previous score
to the new score. Respect reduced motion. Count consecutive
first-try successes in the regular quiz in the combo.
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
covers and original widescreen illustrations based on individual episodes. Give
each film in Rebuild of Evangelion and One Piece Movies an original portrait
poster with the film title lettered on the artwork. Take the title treatment,
palette and composition from the film's release poster as visual cues and
redraw the artwork with distinct staging. Use the edition names of the published
Rebuild subtitles on the artwork and in the gallery. Keep the theatrical titles
searchable. Show the full title below the art and include the code for episodes.
Use numbered placeholders for episodes and portrait placeholders
with a film icon for movies without art. Keep artwork display independent of
Stremio identity and subtitle availability.

Use pink outlines and text for gallery hover and keyboard focus, and white for
the resting episode or movie selection. Keep zoom subtle and quick and respect
reduced motion. Selecting a card replaces the personal vocabulary bar below
search with the selected title's translations, mastery, Practice, Verb Trainer and
Open in Stremio controls in one sticky bar of the same height. Select the same
card again to clear the selection and restore the personal vocabulary bar.
Show Practice and Verb Trainer as raised violet icon buttons with a shared
dumbbell and distinct speech-bubble and る marks. Show their names on hover
and keyboard focus, and keep title-specific accessible names.
Give the selected title's bar a thicker border and a brief highlight each time a
title is selected. Keep the border and skip the highlight for reduced motion.
On phones, leave space above the sticky bar and the Library back control. Keep
the season selector to the right of the wrapping series title.
Keep mastery accessible in the group gallery. Align the mastery bars and group
type labels across each row, even when a title wraps.
Use season and
episode order with codes such as S01E01. Assign stable movie codes across the
full group before filtering or pagination for search. Show movies by title in
the gallery and action bar. Keep Rebuild of Evangelion, One Piece Movies and
Other Movies separate. Fit all controls without horizontal scrolling.

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
