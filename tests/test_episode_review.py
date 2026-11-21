import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from yomiru.vocabulary import anchor_identity

script = Path(__file__).resolve().parents[1] / "scripts/prepare-episode-review.py"
spec = importlib.util.spec_from_file_location("prepare_episode_review", script)
reviewer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reviewer)


class EpisodeReviewTests(unittest.TestCase):
    def setUp(self):
        cues = [
            {"id": "c00001", "start": 1, "end": 1000, "japanese": "猫が走った。",
             "reading_source": "猫が走った。",
             "tokens": [[0, 1, 0], [1, 2, 1], [2, 4, 2], [4, 5, 3], [5, 6, None]]},
            {"id": "c00002", "start": 1001, "end": 2000, "japanese": "猫。",
             "reading_source": "猫。", "tokens": [[0, 1, 0], [1, 2, None]]},
        ]
        anchor = anchor_identity(cues)
        self.source = {"id": "a" * 64, "anchor": anchor, "wordIds": ["cat", "ga", "run", "past"],
                       "cues": cues}
        self.translation = {"id": "b" * 64, "sourceRevision": self.source["id"], "language": "eng",
                            "provenance": "paired", "cues": [
            {"id": cue["id"], "start": cue["start"], "end": cue["end"], "text": text}
            for cue, text in zip(cues, ["The cat ran.", "A cat."], strict=True)
        ]}
        self.vocab = {"anchor": anchor, "words": [
            {"id": "cat", "word": "猫", "reading": "ねこ", "romaji": "neko",
             "pos": "名詞", "meanings": {"eng": ["cat", "feline"]}},
            {"id": "run", "word": "走る", "reading": "はしる", "romaji": "hashiru",
             "pos": "動詞", "meanings": {"eng": ["to run"]}},
            {"id": "ga", "pos": "助詞", "meanings": {"eng": []}},
            {"id": "past", "pos": "助動詞", "meanings": {"eng": []}},
        ]}
        self.revision = "c" * 64
        title = {"videoId": "tt1234567:1:1", "sourceRevision": self.source["id"]}
        self.corpus = {
            "titles": [title], "sources": [self.source], "translations": [self.translation],
        }
        self.review = reviewer.identity(
            title, self.source, self.translation, self.vocab, self.revision,
        )
        self.review["cues"] = {cue["id"]: {"translation": "accepted", "practice": "accepted"}
                               for cue in cues}
        self.review["practice"] = {
            "sourceRevision": self.source["id"], "translationId": self.translation["id"],
            "targets": [
                {"cue": "c00001", "start": 0, "end": 1, "form": "猫", "wordId": "cat",
                 "choices": ["cat", "dog"]},
                {"cue": "c00001", "start": 2, "end": 5, "form": "走った", "wordId": "run",
                 "choices": ["ran", "stopped"]},
                {"cue": "c00002", "start": 0, "end": 1, "form": "猫", "wordId": "cat",
                 "choices": ["cat", "dog"]},
            ],
        }

    def finish(self):
        return reviewer.finish(self.corpus, self.vocab, self.revision, self.review)

    def test_draft_exposes_source_and_all_occurrences_before_acceptance(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "review"
            reviewer.draft(self.corpus, self.vocab, self.revision, destination)
            draft = json.loads((destination / "review.json").read_bytes())
            preview = json.loads((destination / "practice-preview.json").read_bytes())
            self.assertEqual(preview["coverage"]["c00002"]["spans"][0][-1], "needs_review")
            self.assertEqual(draft["cues"]["c00002"]["translation"], "pending")
            with self.assertRaisesRegex(ValueError, "unresolved for c00001"):
                reviewer.finish(self.corpus, self.vocab, self.revision, draft)

    def test_repeated_words_keep_individual_spans_and_stable_mastery_id(self):
        first = self.finish()
        questions = [target for cue in first["practice"]["cues"] for target in cue[5]]
        self.assertEqual([(q[0], q[6]) for q in questions], [
            ("cat", [0, 1]), ("run", [2, 5]), ("cat", [0, 1]),
        ])
        self.review["practice"]["targets"][2]["choices"][1] = "bird"
        self.assertNotEqual(self.finish()["reviewId"], first["reviewId"])

    def test_changed_vocabulary_data_invalidates_review(self):
        self.vocab["words"][0]["meanings"]["eng"].append("house cat")
        with self.assertRaisesRegex(ValueError, "revision changed"):
            self.finish()

    def test_absent_decision_or_missing_occurrence_blocks_release(self):
        original = copy.deepcopy(self.review)
        del self.review["cues"]["c00002"]
        with self.assertRaisesRegex(ValueError, "every source cue"):
            self.finish()
        self.review = original
        self.review["practice"]["targets"].pop()
        with self.assertRaisesRegex(ValueError, "unresolved Practice occurrences"):
            self.finish()

    def test_dictionary_alias_cannot_be_a_wrong_choice(self):
        self.review["practice"]["targets"][0]["choices"][1] = "A feline"
        with self.assertRaisesRegex(ValueError, "known meaning"):
            self.finish()

    def test_paired_portuguese_has_translation_review_without_english_questions(self):
        self.translation["language"] = "por"
        del self.review["practice"]
        for item in self.review["cues"].values():
            item["practice"] = "not-applicable"
        self.assertIsNone(self.finish()["practice"])
