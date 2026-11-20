import unittest

from yomiru.practice_context import practice_projection


class PracticeWordPeekTests(unittest.TestCase):
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
