import unittest

from yomiru.japanese import JapaneseRenderer
from yomiru.practice_context import cue_readings, practice_coverage_rows, practice_projection
from yomiru.reviewed_practice import prepare
from yomiru.vocabulary import anchor_identity


class PracticeWordPeekTests(unittest.TestCase):
    def test_reviewed_peeks_join_reading_tokens_into_whole_dictionary_words(self):
        cue_id = "c00001"
        text = "非常事態に試験運用を宣言した。"
        cues = [{"id": cue_id, "start": 0, "end": 1000, "japanese": text, "reading_source": text,
                 "tokens": [[0, 2, None], [2, 4, None], [5, 9, 1], [10, 12, 2]]}]
        anchor = anchor_identity(cues)
        source = {"id": "source", "anchor": anchor, "cues": cues,
                  "wordIds": ["emergency", "trial", "declare"]}
        translation = {"id": "translation", "sourceRevision": "source", "language": "eng",
                       "provenance": "paired", "cues": [
                           {"id": cue_id, "start": 0, "end": 1000,
                            "text": "They announced a trial run during the emergency."},
                       ]}
        vocabulary = {"anchor": anchor, "words": [
            {"id": "emergency", "pos": "名詞", "meanings": {"eng": ["state of emergency"]}},
            {"id": "trial", "pos": "名詞", "meanings": {"eng": ["trial run"]}},
            {"id": "declare", "pos": "名詞", "meanings": {"eng": ["declaration"]}},
        ]}
        review = {
            "sourceRevision": "source", "translationId": "translation",
            "segments": {cue_id: [
                {"start": 0, "end": 4, "form": "非常事態", "wordId": "emergency"},
            ]},
            "targets": [
                {"cue": cue_id, "start": 0, "end": 4, "form": "非常事態",
                 "wordId": "emergency", "choices": ["state of emergency", "schedule"]},
                {"cue": cue_id, "start": 10, "end": 12, "form": "宣言",
                 "wordId": "declare", "choices": ["declaration", "invitation"]},
            ],
        }
        result = prepare(source, translation, vocabulary, review)
        [(_, kana, romaji, peeks, _, questions)] = result["cues"]
        self.assertEqual(
            [(word, kana[hs:he], romaji[rs:re]) for word, hs, he, rs, re in peeks],
            [("emergency", "ひじょうじたい", "Hijou jitai"),
             ("trial", "しけんうんよう", "shiken un'you"), ("declare", "せんげん", "sengen")],
        )
        self.assertEqual([row[:5] for row in questions], [peeks[0], peeks[2]])

    def test_interjection_keeps_small_tsu_boundary_for_reviewed_span(self):
        text = "まっ どのみち休もう"
        kana, romaji, targets, words, _ = cue_readings(JapaneseRenderer(), text, text)
        first, last = words[0, 1], words[1, 2]
        self.assertEqual(kana[first[0]:last[1]], "まっ")
        self.assertEqual(romaji[first[2]:last[3]], "Ma")
        self.assertNotIn((1, 2), targets)

    def test_coverage_keeps_each_occurrence_and_reports_unreviewed_text(self):
        written = "猫 と猫が歩く。"
        tokens = {(0, 1): "cat", (2, 3): "with", (3, 4): "cat", (4, 5): "subject",
                  (5, 7): "walk", (7, 8): None}
        words = {
            "cat": {"pos": "名詞", "meanings": {"eng": ["cat"]}},
            "with": {"pos": "助詞/格助詞", "meanings": {}},
            "subject": {"pos": "助詞/格助詞", "meanings": {}},
            "walk": {"pos": "動詞", "meanings": {}},
        }
        result = practice_coverage_rows(written, tokens, words, tokens, {(3, 4)})
        self.assertEqual([(written[a:b], status) for a, b, _, status in result], [
            ("猫", "needs_review"), (" ", "separator"), ("と", "grammar"), ("猫", "ready"),
            ("が", "grammar"), ("歩く", "missing_meaning"), ("。", "separator"),
        ])
        self.assertEqual(practice_coverage_rows("猫", {}, words, {}, set()),
                         [[0, 1, None, "unparsed"]])

    def test_projection_retains_repeated_words_and_single_word_cues(self):
        texts = {"c00001": "ネコとネコ。", "c00002": "ネコ。", "c00003": "ネコ。"}
        analysis = {"wordIds": ["cat"], "cues": [
            {"id": "c00001", "text": texts["c00001"], "tokens": [[0, 2, 0], [3, 5, 0]]},
            *({"id": cue, "text": texts[cue], "tokens": [[0, 2, 0]]}
              for cue in ("c00002", "c00003")),
        ]}
        vocabulary = {"words": [{"id": "cat", "pos": "名詞", "meanings": {"eng": ["cat"]}}]}
        rows = {cue: {"reading_source": text} for cue, text in texts.items()}
        projection = practice_projection(analysis, rows, {}, vocabulary, excluded_cues=("c00003",))
        self.assertEqual([cue[0] for cue in projection["cues"]], ["c00001", "c00002"])
        self.assertEqual([[peek[0] for peek in cue[3]] for cue in projection["cues"]],
                         [["cat", "cat"], ["cat"]])

    def test_proper_name_keeps_spelling_and_reading_for_lookup_only(self):
        text, cue_id = "京都で歩く。", "c00001"
        analysis = {"wordIds": ["walk"], "cues": [{"id": cue_id, "text": text,
                    "tokens": [[0, 2, None], [2, 3, None], [3, 5, 0], [5, 6, None]]}]}
        vocabulary = {"words": [{"id": "walk", "pos": "動詞", "meanings": {"eng": ["to walk"]}}]}
        projection = practice_projection(
            analysis, {cue_id: {"reading_source": text}}, {}, vocabulary,
        )
        [(_, kana, romaji, peeks)] = projection["cues"]
        self.assertEqual(
            [(reference, kana[hs:he], romaji[rs:re]) for reference, hs, he, rs, re in peeks],
            [(["京都", "きょうと"], "きょうと", "Kyoto"), ("walk", "あるく", "aruku")],
        )
        self.assertEqual([row[1] for row in projection["examples"]], ["walk"])

    def test_projection_keeps_aligned_word_ids_including_particles(self):
        text = "ネコが歩く。"
        cue_id = "c00001"
        analysis = {
            "wordIds": ["cat", "subject", "walk"],
            "cues": [{"id": cue_id, "text": text,
                      "tokens": [[0, 2, 0], [2, 3, 1], [3, 5, 2], [5, 6, None]]}],
        }
        vocabulary = {"words": [
            {"id": "cat", "pos": "名詞", "meanings": {"eng": ["Cat"]}},
            {"id": "subject", "pos": "助詞/格助詞", "meanings": {"eng": ["Subject marker"]}},
            {"id": "walk", "pos": "動詞", "meanings": {"eng": ["to walk"]}},
        ]}
        projection = practice_projection(
            analysis, {cue_id: {"reading_source": text}},
            {cue_id: "The cat is walking."}, vocabulary,
            reviewed_examples=[(cue_id, "walk", "to walk")],
        )
        [(_, kana, romaji, peeks)] = projection["cues"]
        self.assertEqual(
            [(word, kana[hs:he], romaji[rs:re]) for word, hs, he, rs, re in peeks],
            [("cat", "ネコ", "Neko"), ("subject", "が", "ga"), ("walk", "あるく", "aruku")],
        )
        self.assertNotIn("subject", [row[1] for row in projection["examples"]])

    def test_projection_keeps_counters_in_short_cues_without_literal_english_matches(self):
        cue_id = "c00001"
        text = "3時。"
        analysis = {"wordIds": ["hour"], "cues": [
            {"id": cue_id, "text": text, "tokens": [[0, 1, None], [1, 2, 0], [2, 3, None]]},
        ]}
        vocabulary = {"words": [
            {"id": "hour", "pos": "接尾辞/名詞的", "meanings": {"eng": ["hour"]}},
        ]}
        projection = practice_projection(analysis, {cue_id: {"reading_source": text}},
                                         {cue_id: "Three o'clock."}, vocabulary)
        [(_, kana, romaji, peeks)] = projection["cues"]
        [(_, target_id, gloss, hs, he, rs, re)] = projection["examples"]
        self.assertEqual((target_id, gloss), ("hour", "hour"))
        self.assertEqual((kana, kana[hs:he], romaji[rs:re]), ("3じ。", "じ", "ji"))
        self.assertEqual(peeks, [[target_id, hs, he, rs, re]])
