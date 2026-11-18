Shiberu Japanese Word Frequency List 2026
=========================================

https://shiberu.app/japanese-frequency-list

The 40,727 most frequent Japanese words (lemmas, dictionary forms), most
frequent first, counted by Shiberu with its own analyzer.

Files
-----

  ja-frequency-2026.tsv         UTF-8, tab-separated, one header row
  ja-frequency-2026.tsv.gz      the same file, gzip-compressed
  ja-frequency-2026-README.txt  this file
  LICENSE.txt                   Creative Commons Attribution 4.0 legal code

Stable links to the newest version: https://shiberu.app/data/frequency/ja-frequency-latest.tsv
and https://shiberu.app/data/frequency/ja-frequency-latest.tsv.gz

Columns
-------

  rank         1 = most frequent
  lemma        the word in its dictionary form
  per_million  blended occurrences per million word tokens

How it was made
---------------

Sources (share of the blend):

  - Japanese Wikipedia (encyclopedia, 33.3%): CC BY-SA 4.0. https://ja.wikipedia.org/
  - Aozora Bunko (literature, 33.3%): Public domain works only. https://www.aozora.gr.jp/
  - Tatoeba (example sentences, 33.3%): CC BY 2.0 FR. https://tatoeba.org/

Every text was run through Shiberu's Japanese analyzer (fugashi with
UniDic, the same tagger and lemma rule the Shiberu Reader uses), so each
key is a dictionary form: 言っ -> 言う, 分かっ -> 分かる.

Each corpus gives a per-million rate for every lemma; a lemma's score is
the median of its three rates (ties broken by the mean), so one corpus
cannot push its own oddities up. A lemma must occur in at least two
corpora. per_million is that median rate.

Particles and auxiliaries are kept (they are words a reader counts). Left
out: person names, numerals, symbols, Latin-only tokens and over-long junk.

Only counts are published: no text from any source is in these files.

Licence
-------

CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); the legal code is in LICENSE.txt.
You may copy, share and adapt the list for any purpose, including
commercially, as long as you give credit. Please credit it as:

  Shiberu Japanese Word Frequency List 2026 by Shiberu (https://shiberu.app/japanese-frequency-list), licensed under CC BY 4.0.

Source credits (please keep them with redistributed copies):

  - Japanese Wikipedia (Wikimedia articles dump), CC BY-SA 4.0.
  - Aozora Bunko (青空文庫): a sample of its public-domain works in modern orthography.
  - Tatoeba (https://tatoeba.org/), Japanese sentences, CC BY 2.0 FR.

The sources are credited as their licences and terms ask. The list holds
statistics about the texts (which words occur and how often), not the texts.

Questions and corrections: support@shiberu.app
