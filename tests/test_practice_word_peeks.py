import unittest

from yomiru.practice_context import practice_projection


class PracticeWordPeekTests(unittest.TestCase):
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
