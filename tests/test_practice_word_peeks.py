import unittest

from yomiru.practice_context import practice_projection


class PracticeWordPeekTests(unittest.TestCase):
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
