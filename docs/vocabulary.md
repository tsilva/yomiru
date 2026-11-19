# Vocabulary exports

Choose the book icon (**Browse words**) in the subtitle library to study
all listed episodes and movies with published vocabulary. Check titles to study a subset.
Clearing the last checkbox restores the full library. Vocabulary browsing and
CSV export use English meanings across all subtitle languages. The library
shows the count of words missing an English meaning beside the episode count.
Study the Japanese words alongside kana, rōmaji, grammatical
category and meanings. Expand a label such as **27 more** to see the remaining
English glosses, one per bullet. **Frequency** counts occurrences across the
selected episodes. Shared words appear once, with their counts added together.
The browser shows the most frequent words first by default. Select any visible
column heading to sort by it, then select it again to reverse the order.
**Japanese** sorts by reading and **Other meanings** by the first additional gloss.

Filter by category or find a word by Japanese spelling, kana or rōmaji. Search
includes encountered forms with known readings. For example, `desho` finds
`です` if `でしょ` or `でしょう` occurs in the selection. Meanings match from the
start of a word, including in expanded definitions.

Use **Download full CSV** in the upper-right corner of the word browser to take
the whole selection to a flashcard app or spreadsheet. The export follows your
sort order and covers all selected words, even while the browser is filtered.
Show and movie groups start collapsed. Select a group title to see its episodes
or films. Searching opens matching groups automatically. Library search,
pagination and group collapse preserve the selection. The
shared column header stays below the vocabulary summary as you scroll.

Use the checkbox in a show's heading to select every episode with
published vocabulary, including episodes hidden by search or not yet loaded in
the table. If you uncheck individual episodes, the show checkbox displays a
mixed state. Clicking it again selects the full show. Clearing a fully checked
show leaves other shows' selections untouched. Movie groups work the same way.
If a publication changes while the group is loading, Yomiru reloads the
catalogue in place and keeps selections that still have vocabulary. Hover over
an unavailable group checkbox for details.

## Practice matching words

Select the dumbbell icon (**Exercise**) beside **Browse words** in the subtitle library. Choose a
kana tile with its rōmaji reading, then choose its English meaning. On desktop, `1`–`4` select
Japanese tiles and `5`–`8` select English tiles. The chosen tiles flash green
on a match or red on a miss. Each attempt frees a pair of slots for an incoming
word. A miss resets the combo and brings the word back after a longer wait.

Practice opens with frequent content words. Particles, auxiliaries, affixes and
interjections enter gradually. A grammar word due for review can appear after
the opening content words.

The mastery bar averages the playable words in the full title selection and
shows the percentage to two decimal places. The same row shows how many of
those words you have mastered through delayed reviews.
Words need a usable reading and English meaning to appear in the game. A
shared word counts once and carries the same progress across title selections.
The browser saves reviews automatically as you play. Scores decay between
visits, and successful reviews after a gap help scores hold up longer.
Progress is stored in the current site and browser profile.

For local development with the current published catalogue, run
`YOMIRU_PUBLIC_CATALOGUE=1 npm run dev -- --port auto` from `web/`. With no
titles checked, the preview builds the vocabulary selection from the titles
currently listed in the public catalogue. The preview publishes no changes.

## What counts as a word

Analysis uses pinned UniDic-lite dictionary forms, lexical readings
and grammatical roles. Inflected forms share a vocabulary ID; words with the
same pronunciation are not merged merely because they sound alike. Particles,
auxiliaries, proper names, Japanese number words and counters are included.
Vocabulary browsing, counts and exports exclude punctuation, source
speaker/ruby annotations, digit strings and single Latin-letter tokens such as
the separate letters of a dotted acronym. Compounds follow the analyser's
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

## Export fields

The CSV uses UTF-8 with a byte-order mark, a header and one row per vocabulary ID.
Fields contain the stable ID, Japanese dictionary form, kana, rōmaji, English
meanings (`meaning_eng`), encountered forms, Japanese part of speech, occurrence
count, source episodes, an example sentence with episode and timestamp, meaning
status, dictionary attribution/license/version and Japanese source revisions.
Commas, quotes and newlines are escaped, and spreadsheet formula prefixes are
neutralized. Retain attribution when sharing derived files.

Meanings are dictionary definitions matching the word's reading and broad
grammatical role; they are not selected for the scene. Missing meanings remain
blank with an explicit status and visible missing count, and never remove words.
English definitions use JMdict; proper-name readings use JMnedict and are labelled
as names. The master registry also supports editorial corrections.
Ambiguous fragments, unusual names and foreign text can remain unresolved.
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
  --dictionary /path/to/jmdict-eng.json.tgz --names /path/to/jmnedict-all.json.tgz
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
