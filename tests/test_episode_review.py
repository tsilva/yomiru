import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from yomiru.practice_matching import (
    cue_candidates,
    indexed_spellings,
    paired_words,
    preferred_matches,
    remember,
)
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
            matches = json.loads((destination / "practice-matches.json").read_bytes())
            self.assertEqual(preview["coverage"]["c00002"]["spans"][0][-1], "needs_review")
            self.assertEqual(matches["cues"]["c00002"]["preferred"][0]["wordId"], "cat")
            forms = [row["form"] for row in matches["cues"]["c00001"]["candidates"]]
            self.assertIn("走った", forms)
            self.assertEqual(draft["cues"]["c00002"]["translation"], "pending")
            with self.assertRaisesRegex(ValueError, "unresolved for c00001"):
                reviewer.finish(self.corpus, self.vocab, self.revision, draft)

    def test_longer_contextual_match_wins_without_clipping_an_inflection(self):
        words = {word["id"]: word for word in self.vocab["words"]}
        words.update({
            "white": {"word": "白", "reading": "しろ", "pos": "名詞",
                      "meanings": {"eng": ["white"]}},
            "white-cat": {"word": "白猫", "reading": "しろねこ", "pos": "名詞",
                          "meanings": {"eng": ["white cat"]}},
            "run": {**words["run"], "forms": ["走ら"]},
        })
        spellings, prefix = indexed_spellings(words, {})
        tokens = [(0, 1, "white"), (1, 2, "cat"), (2, 3, "ga"), (3, 5, "run"),
                  (5, 7, "past"), (7, 8, None)]
        candidates = cue_candidates(
            "白猫が走らない。", tokens, paired_words("The white cat doesn't run."),
            words, spellings, prefix, {},
        )
        self.assertEqual([(row["form"], row["wordId"]) for row in preferred_matches(candidates)], [
            ("白猫", "white-cat"),
        ])
        inflected = [row["form"] for row in candidates if row["basis"] == "inflection"]
        self.assertIn("走らない", inflected)
        self.assertIn("猫", [row["form"] for row in candidates])

    def test_paired_context_disambiguates_same_spelling_without_forcing_a_tie(self):
        words = {
            "edge": {"word": "端", "reading": "はし", "pos": "名詞", "aliases": ["はし"],
                     "meanings": {"eng": ["edge"]}},
            "bridge": {"word": "橋", "reading": "はし", "pos": "名詞", "aliases": ["はし"],
                       "meanings": {"eng": ["bridge"]}},
        }
        spellings, prefix = indexed_spellings(words, {})
        for english, expected in (("The bridge.", ["bridge"]), ("The edge.", ["edge"]),
                                  ("The edge of the bridge.", [])):
            with self.subTest(english=english):
                candidates = cue_candidates("はし", [(0, 2, "edge")], paired_words(english),
                                            words, spellings, prefix, {})
                self.assertEqual([row["wordId"] for row in preferred_matches(candidates)], expected)

    def test_saved_matches_prefill_a_new_pending_draft_and_respect_context(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            memory = root / "matches"
            approved = self.finish()
            for _ in range(2):
                remember(memory, self.source, self.translation, self.vocab, self.review, approved)
            self.assertEqual(len(list(memory.glob("*.json"))), 1)
            self.translation["cues"][0]["text"] = "Then the cat ran off."
            draft = root / "changed"
            reviewer.draft(self.corpus, self.vocab, self.revision, draft, memory)
            suggestions = json.loads((draft / "practice-matches.json").read_bytes())
            self.assertEqual(suggestions["reusedCues"], [])
            preferred = suggestions["cues"]["c00001"]["preferred"]
            self.assertIn(("走った", "run", ["ran"]), [
                (row["form"], row["wordId"], row["answers"]) for row in preferred
            ])
            self.translation["cues"][0]["text"] = "The cat ran."
            self.corpus["titles"][0]["videoId"] = "tt1234567:1:2"
            exact = root / "exact"
            reviewer.draft(self.corpus, self.vocab, self.revision, exact, memory)
            new_review = json.loads((exact / "review.json").read_bytes())
            self.assertEqual(new_review["practice"], self.review["practice"])
            with self.assertRaisesRegex(ValueError, "unresolved for c00001"):
                reviewer.finish(self.corpus, self.vocab, self.revision, new_review)
            self.vocab["words"][0]["meanings"]["eng"] = ["domestic cat"]
            stale = root / "stale"
            reviewer.draft(self.corpus, self.vocab, self.revision, stale, memory)
            matches = json.loads((stale / "practice-matches.json").read_bytes())
            self.assertEqual(matches["reusedCues"], [])

    def test_conflicting_review_history_leaves_the_cue_pending(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            memory = root / "matches"
            for choice in ("dog", "bird"):
                self.review["practice"]["targets"][2]["choices"][1] = choice
                approved = self.finish()
                remember(memory, self.source, self.translation, self.vocab, self.review, approved)
            draft = root / "draft"
            reviewer.draft(self.corpus, self.vocab, self.revision, draft, memory)
            matches = json.loads((draft / "practice-matches.json").read_bytes())
            self.assertEqual(matches["reusedCues"], ["c00001"])
            self.assertEqual(matches["cues"]["c00002"]["preferred"][0]["answers"], ["cat"])

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
