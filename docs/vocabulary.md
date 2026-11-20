# Vocabulary

Star episodes or movies in the subtitle library to save them as favorites.
Favorites stay in the current browser across reloads. Choose the book icon
(**Browse words**) to study vocabulary from your favorites. The vocabulary box
shows the unique-word count and how many words lack an English meaning.
Vocabulary browsing uses English meanings across all subtitle languages.
Study the Japanese words alongside kana, rōmaji, grammatical
category and meanings. In the **Meaning** column, expand **27 more** or a
similar link below the first definition to see the remaining English glosses,
one per bullet. **Frequency** counts occurrences across the selected episodes.
Shared words appear once, with their counts added together.
The first column shows your **Mastery** for each word as a small bar and a
whole percentage based on your practice in this browser. Words without a
practice record show **Not practiced**. Find **Category** just before **Frequency**.
The browser shows the most frequent words first by default. Select a column
heading to sort by it, then select it again to reverse the order. **Mastery**
starts with the highest score and keeps words without a score at the end in both
directions. **Japanese** sorts by reading and **Meaning** by the first gloss.

Filter by category or find a word by Japanese spelling, kana or rōmaji. Search
includes encountered forms with known readings. For example, `desho` finds
`です` if `でしょ` or `でしょう` occurs in the selection. Meanings match from the
start of a word, including in expanded definitions. The browser requests 40
matching words at a time and loads additional pages as you scroll. Mastery sort
uses a compact index of the filtered results and loads word details a page at a time.

On phones, all five columns fit across the dialog. Personal mastery stays in
your browser.
Show and movie groups start collapsed. Select a group title to see its episodes
or films. Searching opens matching groups automatically. Library search,
pagination and group collapse preserve favorites. The
shared column header stays below the vocabulary summary as you scroll.

The vocabulary box shows mastery for your favorites beside the unique-word count.
The Mastery column shows a rounded bar with a glossy violet fill and a percentage
for each episode, film and group.
A group's mastery covers every listed title in the group, including titles
outside the current search or page. Each score averages distinct playable
words in its scope. It uses the same browser-stored practice scores as
Exercise, so words shared between titles contribute once.

Use the star in a group heading to favorite all its episodes or films with
published vocabulary, including titles hidden by search or pagination. An
outlined, half-filled or filled star means none, some or all are favorites.
Select a filled star to clear that group's favorites. When the library
updates, Yomiru keeps favorites that still have published vocabulary.

## Practice Japanese meanings

Select the dumbbell icon (**Exercise**) next to Play to practice that episode
or movie in subtitle order, including titles you haven’t starred. The button is
disabled when the title has no published vocabulary. Low-mastery words and
misses come back after a few other prompts. Practice resumes where you left off
after each retry, and two unassisted correct answers clear the word from the
session’s retry queue. Use **Exercise** next to **Browse words** for frequency-based
practice across your favorites.

On mobile, hold your device upright. Exercise opens in fullscreen when the
browser supports it. If you turn the device sideways, rotate it back to resume
your current question. Use **Library** to return to the previous display mode.

When subtitle timing is available, episode practice shows the current subtitle
time and the end of the subtitle timeline below the mastery summary. Hover or
drag over the bar to preview the nearest quiz subtitle’s time, then click or
release to jump. With the bar focused, the arrow keys move between quiz subtitles
and Home and End jump to the first and last. Your saved mastery and pending
retries carry across jumps.

The Yomiru fox reveals a pair of subtitles while practice loads. With reduced
motion enabled, the fox and subtitles stay still. Once practice opens, read the highlighted
word in its subtitle line, then choose its meaning from four English tiles. On desktop, press
`1`–`4` to choose an answer. The answer buttons sit at the bottom of the screen,
with the full subtitle and its reading centered above them. On phones,
**Library**, **Practice** and **Combo** share one row. Answers form a two-by-two
grid on narrow screens. A short, wide screen uses one row for the answers, and
short screens use tighter spacing to fit more subtitle text. At extreme viewport
sizes or text zoom, the whole Practice screen can scroll if needed.
Your chosen tile stays pressed while the quiz shows feedback. A correct answer
turns the tile green and plays a brief chime. The answer’s focus outline clears
when the next question appears. Each unassisted correct answer adds to your
combo. The fox breathes gently between answers, winks on regular successes,
does a double hop at five, dances at ten, and wears a crown from fifteen until
the streak resets. The counter flashes gold every five answers in a row.
A miss resets the combo, marks your answer red, reveals the correct meaning
in green, and gets an encouraging heart from the fox. The quiz advances on
its own, and missed words can return later. With reduced motion enabled,
the fox stays still and still wears the crown for an active streak of fifteen
or more.
Use **Library** to leave practice. A quiz needs four distinct meanings. Use
the library’s Exercise button with more favorites if a single title has too few.

The quiz draws subtitle lines from the titles in the practice session. It shows
hiragana and katakana with smaller rōmaji below and highlights the target in both
lines. Episode practice prefers the first occurrence of each word and uses the
earliest usable example when that cue cannot be shown. Words without usable
context are skipped as quiz targets.

Hover over a word with a dotted underline to highlight it in both scripts.
Click or tap either spelling to peek at its English dictionary meaning. The
quiz also offers lookups for names whose spelling and reading match JMdict.
The highlighted quiz word stays locked. Peeking resets your combo, and a correct
answer on that question leaves the combo at zero.

In episode practice, click or tap the fox next to **Combo** to show or hide the
current subtitle's English translation. The translation starts hidden on each
question and is available where Yomiru has aligned published English text.
Word lookups still work while English is visible. The quiz advances automatically
after answer feedback. Revealing the translation before you answer makes that
answer ineligible for mastery or combo credit, even if you hide the translation
again. Credit already earned stays recorded. A word from a revealed line can earn
credit on a retry with a different line.
When there is no different line, that prompt can earn credit again after the
first delayed review interval, 20 hours after the reveal.

Accepted tile taps give a brief vibration in browsers that support the Vibration API,
such as Chrome for Android, when device vibration is enabled. Safari on iPhone
and iPad lacks support for the Vibration API.

Frequency-based practice opens with frequent content words. Auxiliaries, affixes and
interjections enter gradually. Particles are excluded from exercise prompts,
answer choices and practice mastery. Browse words includes particles and their
dictionary meanings.

Practice loads cards for upcoming rounds as you play. The mastery summary averages
the playable words in the full title selection, including words that have yet to load, and
shows the percentage to two decimal places. The same row shows how many of
those words you have mastered through delayed reviews.
Words need a usable reading and English meaning to appear in the game. A
shared word counts once and carries the same progress across title selections
and practice games.
The browser saves reviews automatically as you play. Scores decay between
visits, and successful reviews after a gap help scores hold up longer.
Progress is stored in the current site and browser profile.

The matching game remains available in code. To make it the Exercise default,
set `defaultPracticeGame` to `"matching"` in
[`VocabularyPractice.jsx`](../web/src/VocabularyPractice.jsx).

For local development with the current published catalogue, run
`YOMIRU_PUBLIC_CATALOGUE=1 npm run dev -- --port auto` from `web/`. With no
titles checked, the preview builds the vocabulary selection from the titles
currently listed in the public catalogue. The preview publishes no changes.

### Run contextual quizzes locally

Import the [private subtitle corpus](publishing.md#regenerate-tracks-from-postgresql)
into local PostgreSQL. Start the preview from `web/` with
`YOMIRU_PUBLIC_CATALOGUE=1 YOMIRU_PRACTICE_CONTEXT_SOCKET=/path/to/socket npm run dev -- --port auto`.
The preview uses the public catalogue for word selection and loads examples
from the local database. Hosted serving uses the same context tables when
they are populated and `YOMIRU_PRACTICE_CONTEXT=1` is set.
Rebuild and reimport older context projections to expand subtitle coverage and
restore aligned word peeks. The translation reveal also reads the corpus's
English translation for the active subtitle revision. The hosted app can also
read the active published English track when the stored translation is unavailable.
The fallback requires a single Japanese cue and a single English line with the same
start and end times.
The preview reads peek meanings from the current registry in the local
database. Examples can still display when the local database has only the
context tables. Hosted episode practice can recover missing peeks from the
archive for the exact same subtitle cue and displayed readings.

## What counts as a word

Analysis uses pinned UniDic-lite dictionary forms, lexical readings
and grammatical roles. Inflected forms share a vocabulary ID; words with the
same pronunciation are not merged merely because they sound alike. The
vocabulary catalogue includes particles, auxiliaries, Japanese number words and
counters. Exercise uses the occurrences of words eligible for practice. Vocabulary analysis
excludes names, title-specific named entities, raw vocalizations, punctuation,
source speaker and ruby annotations, digit strings and single Latin-letter
tokens. Conventional interjections, mimetic words and ordinary uses of a
spelling shared with a name remain eligible. Compounds follow the analyser's
segmentation rather than a hand-curated expression list. Readings and segmentation are automatic,
not independently verified pronunciation or word-sense annotation.

The shared master registry owns each lexeme's canonical dictionary headword,
reading, English meanings, resolution status and dictionary provenance.
Episode vocabulary assets contain IDs, occurrence counts, encountered forms,
additional readings for those forms and source examples. Every episode using a
word receives the same meanings. Adding an episode reuses resolved entries.
Meaning changes create a new registry revision without rewriting episode assets
or Japanese subtitle sources. The browser and export pin that registry revision
while loading. Master coverage grows with the published subtitle library.

Each episode has one versioned Japanese anchor for vocabulary. All newly
published translations reference that anchor. Changing target language, reading
mode or translated text does not change its Japanese word set. Publication
rejects a different Japanese source for an anchored episode; changing the source
requires an explicit complete source migration rather than silently mixing it
with existing translations. Existing legacy subtitle variants remain available;
vocabulary is prepared from an administrator-selected exact published generation.

## CSV API fields

The vocabulary API's CSV response uses UTF-8 with a byte-order mark, a header
and one row per vocabulary ID.
Fields contain the stable ID, Japanese dictionary form, kana, rōmaji, English
meanings (`meaning_eng`), encountered forms, Japanese part of speech, occurrence
count, source episodes, an example sentence with episode and timestamp, meaning
status, dictionary attribution/license/version and Japanese source revisions.
Commas, quotes and newlines are escaped, and spreadsheet formula prefixes are
neutralized. Retain attribution when sharing derived files.

Meanings are dictionary definitions matching the word's reading and broad
grammatical role; they are not selected for the scene. Missing meanings remain
blank with an explicit status and visible missing count, and never remove words.
English definitions use JMdict. The master registry also supports editorial
corrections. A genuine lexical entry with no supported English meaning stays
in the catalogue. Matching practice requires a usable reading and meaning.
Editorial corrections take precedence and retain separate provenance.

For future Anki use, keep `vocabulary_id` as the first field of a custom note type,
then map Japanese, reading and meaning to separate fields. Keep the IDs when
reimporting to update notes. For CSV import setup, see the
[Anki text import guide](https://docs.ankiweb.net/manual/importing/text-files).
Automatic deck creation, Anki synchronization, audio and images are future work.

## Administrator preparation

After the incremental catalogue is live, seed its shared dictionary with
the English JMdict Simplified archive through the reviewed publication route.

```sh
uv run yomiru jmdict-rows --dictionary /path/to/jmdict-eng.json.tgz |
  node web/scripts/seed-jmdict.mjs --executor EXECUTOR --deployment HOSTNAME
```

The import records original JMdict entry IDs. Matching spelling, reading and
part of speech can link existing words and fill blank meanings. Existing
definitions and IDs take precedence. Study counts only include words used by
the selected subtitles.

After verifying the production executor and AgentBridge, install the macOS
review service on the AgentBridge host.

```sh
uv run yomiru review-service install --node /absolute/path/to/node \
  --executor /absolute/path/to/executor --deployment HOSTNAME
```

The service runs a bounded batch at startup and every 15 minutes. The same flags
identify the service to `review-service uninstall`. To process one batch manually,
run `node web/scripts/review-words.mjs --executor EXECUTOR --deployment HOSTNAME`.
The reviewer receives excerpted evidence and dictionary candidates. The server
verifies the cited cue and entry before updating a meaning. Unsupported
decisions remain unresolved. For a flagged tokenization error, prepare the
revised analysis and matching vocabulary for the same archived source, then
pass `--correct-word-id WORD_ID` to the incremental uploader. It verifies
the replacement counts against the archive and preserves the subtitle tracks.

Generation and dictionary lookup run locally before publication. Publication
validates the master registry and episode references, then imports them into
Neon. Public serving counts distinct word IDs for the selection and loads
study and export details on demand. Public requests perform no tokenization or
inference.

Obtain current JMdict English data from the
[JMdict project](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project),
or its [JMdict Simplified distribution](https://github.com/scriptin/jmdict-simplified).
The loader accepts JMdict XML, gzip XML, or the distribution's English
`.json.tgz` archive, reading without archive extraction. Keep the dictionary
outside tracked source; preserve its checksum with reconstruction inputs.

Build or refresh the master registry across a complete published library:

```sh
uv run yomiru vocabulary-registry --data-dir /path/to/library \
  --pairs-root /path/to/exact-generation-pairs \
  --dictionary /path/to/jmdict-eng.json.tgz
```

This requires exact canonical Japanese generation inputs for every covered
episode, preserves Japanese anchors and ASS assets, and resolves meanings once
across the registry. The analysis version is explicit. Version 2 fixes analyzer
token invalidation during romanization and uses lexical headwords/readings;
invalid historical entries are replaced rather than assigned invented meanings.
Version 3 excludes digit strings and single Latin letters. Rebuild and publish
the complete library to apply version 3 to existing episodes.
Older assets support rōmaji search for kana forms immediately. Rebuild and
publish the vocabulary assets to add readings for their kanji forms.

Version 4 excludes proper names and raw vocalizations during analysis. For the
incremental catalogue, stage the cleanup against the exact archived Japanese
source and the current vocabulary descriptor for each title:

```sh
uv run yomiru study-vocabulary --pairs PAIRS.json --japanese-source ORIGINAL.srt \
  --data-dir STAGING --video-id VIDEO_ID --exclude-spans REVIEWED.json
```

The optional review file maps cue IDs to arrays of `[start, end]` token spans
using zero-based Unicode code-point offsets in the cleaned Japanese cue. Apply
it only to that cue's reviewed use. The command emits the new vocabulary
descriptor and private archive manifest. Combine those records into a JSON
array, adding the current vocabulary hash as `previousVocabulary` to each.
Use one staging directory for all affected titles and put the plan there.
For a new title, pass the same review file to `yomiru publish --exclude-spans`
along with the original Japanese source and private archive directory.

```sh
node web/scripts/upload-episode.mjs --study-batch STAGING/plan.json \
  --executor EXECUTOR --deployment HOSTNAME
```

The batch activation checks the original source, archived token counts, current
vocabulary revision and unchanged IDs for the surviving words. It publishes
the replacements together without re-uploading or changing any subtitle track.
An unchanged Japanese source keeps its reviewed vocabulary when a translation
is added.

To enrich an exact already-published episode, without altering its ASS assets:

```sh
uv run yomiru vocabulary --pairs /path/to/pairs.json --video-id tt1234567:1:1 \
  --dictionary /path/to/jmdict-eng.json.tgz --data-dir /path/to/library
```

The pairs must match that episode's published generation checksum. New episodes
use the same `--dictionary` option with `yomiru publish`. Without a dictionary,
already-resolved master entries retain their meanings; only genuinely new entries
remain unresolved. Dictionary refreshes keep lexical IDs and Japanese anchors
unchanged. Refresh dictionary data at least monthly and publish a complete snapshot.

Correct meanings centrally with `yomiru vocabulary-meanings --data-dir
/path/to/library --corrections /path/to/corrections.json`. The JSON has an `entries`
array. Each item supplies an existing `id`, `language` set to `eng`, a nonempty
`meanings` array and public HTTPS `sourceUrl`. Corrections are labelled curated,
retain evidence, and survive dictionary refresh. No episode asset changes.
Use `--update-registry` with the administrator upload command when intentionally
publishing changed meanings. Ordinary episode uploads preserve current resolved
meanings and add new entries without reverting prior corrections.

Use the existing [upload workflow](publishing.md#upload-and-serve), first with
`--dry-run`. Vocabulary assets are immutable and content-addressed alongside
subtitle assets. The snapshot binds each movie and episode to its vocabulary
hash, anchor and exact count. The upload script requires matching vocabulary
for each new or revised subtitle track, and preserves existing coverage.
Referenced vocabulary objects are validated before activation. The
compressed master registry is retained as a content-addressed import and
restore asset. It has a 3 MiB upload limit and a 16 MiB decoded limit. The
vocabulary API reads the imported rows.
Subtitle updates reuse already-published vocabulary when the exact Japanese
source remains present. New movies and episodes ship with their vocabulary in
the same publication.

English dictionary definitions and proper names are derived from JMdict/JMnedict,
copyright James William BREEN and
the Electronic Dictionary Research and Development Group, under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The vocabulary
assets and exports include attribution, license links and the dictionary checksum;
the dictionary data license is separate from Yomiru's software license. See the
[EDRDG license statement](https://www.edrdg.org/edrdg/licence.html).
