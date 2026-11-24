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
receive the Japanese learning line above that source in styled ASS. Start every
Yomiru subtitle picker label with the 🦊 emoji and the reading mode. Keep source
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
website. Publish original episode artwork as an immutable asset in the same
library revision as the episode. Verify immutable assets before atomically
activating the matching library revision. Preserve existing Stremio URLs and
published coverage.
Publish catalogue, track and vocabulary changes incrementally for the affected
titles. Preserve word IDs and published vocabulary when migrating the existing
library. Retire superseded subtitle and feedback links in the playback cutover.
Keep the original Japanese subtitles and
versioned cue and token positions private and reusable across translations and
reading modes.
Keep private database inputs sufficient to regenerate an available language in
any supported reading mode and to reproduce published ASS byte for byte.
Retain legacy rendered timelines and their provenance when exact translation
pairs are unavailable. Generate and verify tracks before public serving.
For new bilingual tracks, review every cue against the exact Japanese source
and paired translation before activation. AgentBridge may collect evidence-backed
subtitle review proposals in a separate pass. Preserve the exact review inputs,
validated cue coverage, and unresolved findings so the job can resume without
repeating completed work. Adjudicate proposals before recording corrections.
For English Practice, review both
scored and excluded spans, keeping full contextual expressions and checking
readings, meanings, alternatives, and credited vocabulary separately. Preserve
the reviewed questions with their release inputs and replay every question
before activation and against the published exercise. Render the release files
from the stored cues. Check reviewed questions against the effective publishing
dictionary before activation and identify any conflicts by cue and vocabulary
ID. Resume interrupted preparation from verified inputs and outputs. Reuse the
provisioned publisher for successive episodes without per-episode credentials
or setup.
Default new episodes and movies to two bilingual tracks, Kana + English and
Rōmaji + English, unless the owner specifies another language or reading mode.
Generate both from the same Japanese source, cue timings, and paired translation.
Apply the same Practice review and live verification to additions and maintenance.
Restrict uploads to the administrator. Public playback never runs translation
or language-model inference. Episode Practice may call its tutor only on an
explicit chat submission.
Serve the published ASS without an opening feedback card. Preserve dialogue,
styling, geometry, timing, and explicit positioning for Stremio playback.
Publish one gzip-compressed, playback-ready ASS per subtitle variant under
`library/<sha256>.ass`. Hash the stored bytes for the download URL and preserve
the track ID and decoded ASS checksum across encoding changes. Allow clients
without gzip support to receive plain ASS through Cloudflare.
Offer direct Cloudflare R2 asset URLs in Stremio. Serve the same files through
Cloudflare for website downloads and redirect existing app-domain download links.
Cache successful immutable downloads for one year in browsers and at the CDN.
Use active Neon track paths as the keep list for ASS storage cleanup. Protect
uploads in progress, and show the exact candidates before any deletion.
Support an owner-triggered GitHub cleanup with a dry run by default and
require the reviewed plan's fingerprint for deletion.
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

Use “🦊 Romaji”, “🦊 Kana”, and “🦊 Japanese” in the hosted subtitle picker,
in that order. Prefer tracks with a Japanese source anchor over legacy tracks
for the same episode, translation
language and reading mode. Group hosted
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
Default to the most frequent words in the published subtitle library.
Show each word's occurrence count across the published subtitles as the sole
frequency measure. Omit ranks and frequency-type controls. Let learners sort by a
vocabulary data column and reverse its direction.
Place the dictionary star in the first column, followed by personal practice
mastery with a ring around the whole percentage.
Show an em dash when there is no mastery score.
Show a compact **Due in** countdown such as “9h45m” beside Mastery, using
the browser's saved practice schedule. Place Subcategory between Category and
Frequency and show the dictionary-backed verb type when available.
Let learners sort the full filtered selection by mastery or next
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
Browse and search the shared dictionary, including entries without published
subtitle occurrences or practice history. Let learners toggle a star for each
dictionary entry and switch between All words and Starred. Save stars and
practice history in the browser across reloads and gallery navigation. Keep Browse
words and Review available when practice history is empty. Continue saving
introduced words when Practice shows a meaning question, including unanswered questions.
Omit title and group stars and the website CSV download action. Load study
details on demand and make failures explicit.
In the word browser, load more results and their details as learners scroll.
Keep the search field unfocused when the dialog opens. Use a compact visible Vocabulary heading. Give the Meaning column the most desktop table width. On phones,
hide Category, Subcategory, Frequency, and the additional meanings control. Fit
the star, Mastery, Due in, Japanese, and Meaning without horizontal scrolling, with
sort arrows beside their labels.
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
eligible occurrences to frequency, selection counts and CSV exports. Use
those occurrences as the source for practice eligibility. Exclude uses as proper
names and title-specific named entities, raw digit strings, isolated Latin letters, non-lexical sounds and
tokenization debris. Keep ordinary uses of the same spelling, Japanese number
words and counters, conventional interjections and mimetic words. Keep genuine
words with unresolved meanings visible and exportable. Matching practice
requires a usable reading and meaning. Preserve subtitle cues and existing IDs
for surviving words. Use source context to review ambiguous tokens and apply
exclusions to the affected occurrences only. Phrase search across subtitle lines is future work.

## Vocabulary practice

Offer **Word Drill** alongside **Vocabulary** and **Verbs** in the Practice
menu. Open directly on the first question. Drill dictionary forms across the
library, starting with starred entries, including entries with zero subtitle
uses, then filling the round by descending published subtitle frequency.
Mix kana-to-English and English-to-kana questions with four distinct choices
and one valid answer. Use the shared Japanese reading layout in prompts and
answers, with kanji when available above kana and rōmaji below. Omit direction
labels and star indicators. Keep the existing answer layout and desktop number shortcuts.
Record first-attempt results by dictionary word ID and preserve earlier
contextual practice evidence. Keep stars and performance in the browser.
Show the shared combo counter, Yomiru chat button and mastery notifications in
Word Drill. Attach the current dictionary entry to chat and pause answers while
the panel is open. Count first-try, unassisted successes toward the combo. Reset
the combo after a miss or tutor assistance. A turn aided by a tutor reply earns
no mastery credit. Show the credited entry and score after a saved correct
answer or a mastery change. Keep one chat conversation for the drill round.
Attach each learner message to its own dictionary entry. Send at most four
previous exchanges with a new question, in conversation order. Keep the
transcript in the active round and reset it when starting another round.
An earlier reply does not mark a later question as assisted.

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
example. Show its movie title or its series name, episode code and episode
title, with the source subtitle start time when available. Show four prepared
English choices and hide the English subtitle.
Use the existing word ID and review schedule for meaning questions. Grade the
first selection and use the episode quiz’s feedback and retry behavior for
both question types. On completion, show the Yomiru fox, count the reviewed
questions and offer Review again. Keep the Library navigation and use a
neutral empty state when no questions are available.

Offer Verb Trainer alongside Practice in the selected title’s practice menu. Use the
selected title’s actual verb occurrences and introduce verbs by frequency,
mixed with forms due for recall. Prepare supported modern verb forms and the
four choices before serving them, linked through the shared vocabulary.
Keep the written Japanese, kana, rōmaji, and English meaning together. Place a
smaller form label directly below the English meaning.
In Verb Trainer and Review, show the English dictionary gloss and an English
equivalent of the requested form on the same line, separated by a middle dot.
Put a question-mark button beside every form label in Verb Trainer and Review.
Open its guide as a tooltip without moving the prompt or answer tiles. Explain
when to use the form and how to build it for Godan,
Ichidan, and Irregular verbs. Highlight the current verb type’s rule in the
first row, including for shared rules. Write Japanese sounds and endings in
rōmaji and use rules that apply without giving the current verb’s answer.
Show written Japanese, kana and rōmaji on each tile. When the written form
matches the kana, show it once with rōmaji underneath. Keep conjugation
mastery and review dates per vocabulary ID and form. Meaning questions affect
the verb’s vocabulary mastery and conjugation questions affect the queried form.

Open Practice from the selected title’s practice menu and study only that title.
Enable Practice only when the title has a current reviewed exercise. Otherwise,
show the disabled mode with its explanation in the practice menu. A
direct link to an unsupported title opens a centered message with a disappointed
Yomiru fox and Library navigation. Keep subtitles available. Give supported
episodes a shareable Practice URL under the
series and episode slugs. Opening or reloading that URL starts the same exercise.
When leaving episode Vocabulary opened from the gallery, return to that gallery
with the episode deselected and focus on its card.
In episode Practice, start with the first playable subtitle and follow subtitle
order. Within each cue, highlight each eligible word occurrence from first
to last, including repeated words. Show **New word** and a single button with
the contextual English meaning until the learner acknowledges the teaching
card or recalls the word correctly. Words previously displayed or missed
remain eligible for teaching. Save the acknowledgement in the browser.
Tapping the meaning or pressing `1` continues through the cue and queues a
full replay. On desktop, show the `1` shortcut on the button. Omit the arrow.
Only quiz answers earn mastery or combo credit. At the end of a cue
that introduced any words, return to its first eligible occurrence and quiz
every occurrence, including words answered correctly on the first pass.
Advance to the next cue after the learner answers every occurrence on the
replay correctly. Cues without an introduction require one pass.
Include the published opening lyrics in reviewed Practice for every Evangelion
TV episode, using each episode's Japanese source timings. Instrumental passages
have no vocabulary questions.
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
Keep fixed expressions and meaning-changing endings in the highlight. Use the
full lexical entry when the contextual answer belongs to that expression.
Share mastery across equivalent spellings and uses of the same dictionary
sense. Give homographs separate credit when their readings or senses differ.
Highlight a group pronoun with its たち or ら ending, including 達 or 等
spellings. Use its contextual group meaning and credit the full pronoun's
dictionary entry.
Save reviewed matches privately for reuse. Treat suggested and reused matches
as pending until the new episode review is complete.
While practice opens, center the Yomiru fox revealing Japanese and English
subtitles above the loading status. Place the fox and its soft glow directly on
the screen background. Animate the fox and loading dots unless reduced motion
is enabled.

In episode Practice, show the current subtitle time and total duration beside
a scrubber when timing is available. Preview the nearest subtitle on hover or
drag, and jump to its first eligible word on click or release. Support keyboard
seeking across the full subtitle timeline and preserve mastery and pending
retries. Keep the vocabulary progress bar above the scrubber. Omit the visible
scrubber label and leave room between the current time and the drag handle.

Randomly choose a direction for each new question in subtitle Practice. Highlight
the target in the question language and offer four distinct shuffled choices in
the other language. Exclude other valid answers and prefer distractors from the
same part of speech. In English-to-Japanese, use the exact forms of four aligned
words from the same subtitle in the Verb Trainer card format. If the English
highlight is ambiguous or the cue lacks three plausible distractors, use
Japanese-to-English. For English choices, prefer distractors related to the
reviewed meaning and distinct other hues for a color. Use the current episode
before other published subtitles to fill the choices.
Both directions credit the same vocabulary ID and review
schedule. Keep the direction and choices on retry. On desktop, 1–4 select
an answer directly. Keep the answer buttons at the bottom of the viewport and
center the full prompt vertically between them and the header in every quiz
mode. Highlights, mastery feedback and tooltips should leave the prompt in place.
On mobile, entering Review requests fullscreen and portrait orientation when
the browser permits them. Return to the previous display mode when leaving.
Use a full-width exercise toolbar. Place Library on the left and the source
title in the center, with the episode code, title, and source time when
available below the series name. On narrow screens, put the timestamp on its
own line and keep the toolbar compact with the browser controls visible.
Use the movie title for films, or the mode
name when there is no source. Put the round count on the right as “1 of 12”
and show Combo with the fox for title-specific exercises. Place the thick
vocabulary progress bar across the full width below this row. Keep percentages
available to assistive technology without printing them under the bar.
Keep the mobile controls below the display
cutout, including in fullscreen browsers that do not expose a safe-area inset. Use a two-by-two
answer grid on narrow screens and a single row on
short screens with enough width. On short screens, tighten the spacing and
compact the controls to fit the full subtitle and four answers together. Keep
all readings legible and let long text wrap. If the contents still exceed the
viewport at an extreme size or text zoom, let the whole screen scroll. Lock the
choices during feedback. Play a short chime and show green feedback on a correct
answer, then advance. On a miss, mark just the selected answer red and retry the
same word without revealing the correct answer. Use the first attempt at each
occurrence for mastery and combo credit.
Include a particle as a Practice and Review question when its exact use in
the cue has a reviewed English answer and three distinct, incorrect choices.
Use Japanese-to-English for particle questions so the highlight establishes
which occurrence and grammatical function the learner is answering about.
Credit the particle's existing vocabulary ID and include it in the reviewed
mastery total. Keep particles available for lookup when they have no question.
Keep grammar that depends on a larger expression inside that expression.

Use mixed kana as the main reading, with smaller rōmaji and the full published
English translation below it. Show a small, gray original Japanese line close
above the kana when the source spelling is available. For Japanese prompts,
highlight the target in the kana, rōmaji and aligned original Japanese. For
English prompts, highlight the matching words in the translation and leave
the Japanese readings intact. Once a cue is queued for replay, hide the
translation on Japanese-to-English quiz questions until the cue is complete.
Show it during teaching and when it supplies the English prompt. Showing the
phrase translation in the normal quiz preserves eligibility for credit.
Indicate when a verified English line is unavailable where shown.
Skip words without an aligned reading or usable meaning and exclude cues from
older Japanese source revisions.

In normal Japanese-to-English Practice, let learners peek at the English
dictionary meaning of other words when aligned readings and meanings are
available. Disable word peeks during teaching, while the translation is
hidden, and in English-to-Japanese Practice.
Show an aligned compound as a single peek even when its reading spans multiple
tokens.
Include proper names with a JMdict match for the spelling and reading. Hovering or
focusing a word highlights it in both kana and rōmaji. Activating either
spelling opens a tooltip anchored to the rōmaji word and silently resets the
combo. Show the dictionary kanji spelling when available and separate it from
the phrase's kana and rōmaji with middle dots. Put the English gloss on its
own row. Below it, show the part of speech and the dictionary conjugation
class for verbs when available, alongside the word's personal mastery
percentage or “Not practiced”. Show particle mastery once the learner has
practised it.
Keep the tested word unavailable for peeking throughout the line.
Learners can still answer, and an assisted answer earns no combo increment.

In episode and movie Practice, let learners open a contextual chat from the
toolbar fox or a word lookup. Dock it beside the exercise on desktop and use a
bottom sheet on phones. Begin with a message from Yomiru without a separate
chat header. Preview the selected subtitle as an attachment above the composer,
then show it with the learner's first message. Include the timestamp, Japanese
line, selected word and available translation. Identify speakers visually by
their avatars. While waiting for a reply, show Yomiru's avatar beside a bubble
with three pulsing dots in the transcript. Keep the dots still with reduced
motion and announce the pending reply to screen readers. Let learners return
to the previous line after Practice advances and resume the current question
on close. An answer aided by a chat reply
receives no mastery or combo credit.

Yomiru speaks as a playful, helpful Japanese-native fox. He uses occasional
emojis and can take a moment to find the right words in English. Teach for
spoken comprehension. Lead with rōmaji, add kana when helpful, and use kanji
as a reference for spelling when needed or requested. Keep his Japanese,
examples and explanations accurate. Bold Japanese text and quoted
expressions in Yomiru's replies. Omit Japanese corner brackets. Support contextual
word questions and translation checks, with explicit uncertainty where the scene
matters. A conversation does not edit published subtitles. Use AgentBridge with Codex
`gpt-6.2-sol` at low reasoning in development and OpenRouter for hosted chat.

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

Save one mastery record per stable vocabulary ID in the browser and carry it
across selections and games. Load cards for upcoming rounds on demand. Load
catalogue and vocabulary details when a viewer needs them. Keep review scores
and scheduling in the browser.

Use one compact vocabulary progress bar in the library summary,
selected title actions, Practice, Review, and Verb Trainer. The Library and
Practice use the same reviewed word list and mastery rules for a title. Hide
its bar when it has no reviewed Practice. Group and library-wide bars count
each distinct word across currently published reviewed exercises once, including
beyond the visible page or loaded batch. A word counts as introduced as soon as
Practice shows it as a question, including when it goes unanswered. Gold marks mastered words, violet
marks the other introduced words, and the remaining track shows unseen words.
Both percentages use the same total. Show them on one line below the track
when space allows, introduced first and mastered second. Use thicker, glossy
tracks in the library. Keep summary word counts and percentages available to
screen readers. Show selected title percentages on hover or keyboard focus.
Overlay a smaller track along the bottom of group covers, episode artwork, and
movie posters with screen-reader text.

Score each word for estimated meaning recall in seven days without more practice. A meaningful
first correct answer gives visible early progress. Repeated answers in the
regular quiz give practice and combo feedback without postponing a scheduled
review. Base the review's mastery credit on the actual time since the learner
was last quizzed on the word across episodes. In episode Practice, a due word's
first question doubles as its delayed review. Keep subtitle order, show the
choices immediately, and disable word lookups for that question. Grade the first
selection and let learners retry
a miss before advancing.
Count a word as mastered once it reaches the final delayed-review stage
with its current reading and meaning. Decay the score with time away
and weaken decay after successful delayed reviews. A missed review can
shorten the review interval while preserving prior evidence.
After a first-try correct answer, show a temporary notification with the
credited vocabulary entry's dictionary spelling, kana, English gloss and
current mastery. For conjugation questions, show the credited form and its
label. For any saved mastery change, show both scores and animate the bar from
the previous score to the new score. Respect reduced motion. Count consecutive
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
Place a direct Stremio button within the guide and use the same dark violet
upper-left close control as the vocabulary and Practice dialogs. Center it on
the corner where viewport space permits. Omit an empty
header row, automatic button highlight and “Coverage is growing”.
Show keyboard focus through a fill, underline or another cue without a ring.

Place the subtitle library below the landing hero with the approved blue fade
and the heading **Library**. Ship the latest published catalogue with the page
so the gallery and title search work on first render. Check for catalogue
updates in the background and keep the visible gallery steady while mastery
loads. Show full-width search with a search icon between
the vocabulary bar and the group covers. Hide search and the library-wide
vocabulary bar inside a group, and use the Library heading as the back control.
Show series and film collections as a cover
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

Use the button palette's violet for gallery text on hover and keyboard focus.
Underline the focused title and use white for the episode or movie selection.
Keep zoom subtle and quick and respect
reduced motion. Selecting a card opens a sticky bar with the title and its
Practice and Open in Stremio controls on the same row. Include
mastery where available.
Select the same card again to clear the selection and close that bar.
Use matching raised violet controls with a dumbbell for Practice and a play icon for
Open in Stremio. Show their names on hover and keyboard focus, and keep
title-specific accessible names. Practice opens a compact modal with one labeled
control per row. Use **Vocabulary** with a speech bubble and **Verbs** with る.
Give the selected title's bar a steady border. Reveal the progress label on
keyboard focus without drawing a separate outline around its track.
On phones, leave space above the sticky bar and the Library back control.
Keep mastery accessible in the group gallery. Align the mastery bars and group
type labels across each row, even when a title wraps.
Show episodes in season and episode order with codes such as S01E01. Use season
headings in one scrolling gallery and load more episodes near the bottom.
Align the season dropdown beside the series title and use it to jump to a season heading.
Assign stable movie codes across the
full group before filtering or pagination for search. Show movies by title in
the gallery and action bar. Keep Rebuild of Evangelion, One Piece Movies and
Other Movies separate. Fit all controls without horizontal scrolling.

Search by group name, title, code or translation across the published library.
Show matching groups and titles, and load more as the viewer approaches the page
bottom. While loading an empty gallery, center the outlined Yomiru mascot and
spinner vertically in the space beneath search. Provide a screen-reader status.
Center the empty results message horizontally.
Respect reduced motion. Show only published availability and retain timing
uncertainty in subtitle or source details. The secondary **Browse subtitles**
link uses a down chevron at the foot of the hero, scrolls to the library and
respects reduced motion. Center the label above the chevron on mobile. Preserve the
full-viewport landing hero.

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
