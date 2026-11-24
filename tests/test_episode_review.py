import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from yomiru.practice_lexemes import (
    EXPRESSIONS,
    duplicate_credits,
    expression_spans,
    validate_expressions,
)
from yomiru.practice_matching import (
    cue_candidates,
    indexed_spellings,
    paired_words,
    preferred_matches,
    remember,
)
from yomiru.practice_pronouns import group_pronouns
from yomiru.reviewed_practice import prepare
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

    def test_reviewed_particle_uses_context_and_keeps_its_dictionary_identity(self):
        particle = next(word for word in self.vocab["words"] if word["id"] == "ga")
        particle.update(word="が", reading="が", romaji="ga",
                        meanings={"eng": ["subject marker", "but"]})
        self.review.update(reviewer.identity(
            self.corpus["titles"][0], self.source, self.translation, self.vocab, self.revision,
        ))
        self.assertNotIn("supplementalCards", self.finish()["practice"])
        target = {"cue": "c00001", "start": 1, "end": 2, "form": "が", "wordId": "ga",
                  "choices": ["marks who ran", "marks where it happened", "marks when it happened"]}
        self.review["practice"]["targets"].append(target)
        with self.assertRaisesRegex(ValueError, "four contextual choices"):
            self.finish()
        target["choices"].append("marks the object")
        practice = self.finish()["practice"]
        self.assertEqual(practice["cues"][0][5][1], ["ga", 2, 3, 5, 7, target["choices"], [1, 2]])
        self.assertEqual(practice["supplementalCards"][0][:7], [
            "ga", "が", "ga", "subject marker", "が", "subject marker", ["subject marker", "but"],
        ])
        target["choices"][-1] = "subject marker"
        with self.assertRaisesRegex(ValueError, "known meaning"):
            self.finish()

    def test_focused_packet_rechecks_changed_cue_and_repeat_with_exact_compiled_text(self):
        def rows():
            return reviewer.review_rows(
                self.source, self.translation, self.vocab, self.finish()["practice"],
                self.review["practice"],
            )

        metadata = {"videoId": self.review["videoId"]}
        with tempfile.TemporaryDirectory() as directory:
            initial = Path(directory) / "complete.jsonl"
            reviewer.write_packet(initial, metadata, rows())
            self.review["practice"]["targets"][0]["choices"][1] = "kitten"
            focused = Path(directory) / "focused.jsonl"
            reviewer.write_packet(focused, metadata, rows(), initial)
            header, changed, repeat = map(json.loads, focused.read_text().splitlines())
        self.assertFalse(header["complete"])
        self.assertEqual(changed["focus"], "changed")
        self.assertEqual(repeat["focus"], "repeat")
        self.assertEqual(changed["questions"][0]["highlight"][:2], ["猫", "ねこ"])
        self.assertEqual(changed["questions"][0]["choices"], ["cat", "kitten"])
        self.assertEqual(changed["questions"][0]["wordId"], "cat")

    def whole_expression_fixture(self):
        sentence = "勝手に走った。"
        self.source["cues"][0].update(
            japanese=sentence, reading_source=sentence,
            tokens=[[0, 2, 4], [2, 3, 1], [3, 5, 2], [5, 6, 3], [6, 7, None]],
        )
        self.source["wordIds"].append("katte")
        self.translation["cues"][0]["text"] = "I ran without asking."
        self.vocab["words"].append({
            "id": "katte", "word": "勝手", "reading": "かって", "romaji": "katte",
            "pos": "名詞", "meanings": {"eng": ["one's way"]},
        })
        self.source["anchor"] = self.vocab["anchor"] = anchor_identity(self.source["cues"])
        self.review.update(reviewer.identity(
            self.corpus["titles"][0], self.source, self.translation, self.vocab, self.revision,
        ))
        practice = self.review["practice"]
        practice["targets"][0].update(
            end=2, form="勝手", wordId="katte", choices=["without asking", "in a hurry"],
        )
        practice["targets"][1].update(start=3, end=6)
        return practice

    def test_draft_suggests_dictionary_expression_even_when_only_its_stem_is_indexed(self):
        self.whole_expression_fixture()
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "draft"
            reviewer.draft(self.corpus, self.vocab, self.revision, destination)
            matches = json.loads((destination / "practice-matches.json").read_bytes())
            cue = matches["cues"]["c00001"]
            self.assertEqual(cue["wholeExpressions"], [
                {"start": 0, "end": 3, "form": "勝手に", "jmdictEntryId": 1346200},
            ])
            [first] = [item for item in cue["preferred"] if item["start"] == 0]
            self.assertEqual(
                (first["form"], first["kana"], first["answers"]),
                ("勝手に", "かってに", ["without asking"]),
            )
            self.assertNotIn("katte", [item["wordId"] for item in cue["candidates"]])
            self.assertTrue(first["suggestedWord"]["registry"])

    def test_review_requires_exact_span_and_full_entry_but_keeps_inflected_verb_credit(self):
        practice = self.whole_expression_fixture()
        with self.assertRaisesRegex(ValueError, "Highlight the whole expression 勝手に"):
            self.finish()
        practice["targets"][0].update(form="勝手に", end=3)
        with self.assertRaisesRegex(ValueError, "Credit 勝手に .* to its full entry"):
            self.finish()

        rule = next(rule for rule in EXPRESSIONS if rule.headword == "勝手に")
        full = rule.candidate("かってに", lambda reading: "katteni")
        practice["supplementalWords"] = [full]
        practice["supplementalMeanings"] = {full["id"]: "without asking"}
        practice["targets"][0]["wordId"] = full["id"]
        practice["segments"] = {"c00001": [
            {"start": 0, "end": 3, "form": "勝手に", "wordId": full["id"]},
        ]}
        questions = self.finish()["practice"]["cues"][0][5]
        self.assertEqual([(q[0], q[6]) for q in questions], [(full["id"], [0, 3]), ("run", [3, 6])])

    def test_legacy_stem_review_does_not_prefill_a_whole_expression(self):
        practice = self.whole_expression_fixture()
        compiled = prepare(self.source, self.translation, self.vocab, practice)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            legacy = {"practice": compiled, "reviewId": "e" * 64}
            remember(path / "cache", self.source, self.translation, self.vocab, self.review, legacy)
            reviewer.draft(self.corpus, self.vocab, self.revision, path / "draft", path / "cache")
            matches = json.loads((path / "draft/practice-matches.json").read_bytes())
            self.assertEqual(matches["reusedCues"], ["c00002"])

    def test_release_detects_split_mastery_for_sufficiently_across_parts_of_speech(self):
        lesson = [
            ("十分走った。", [[0, 2, 4], [2, 4, 2], [4, 5, 3], [5, 6, None]]),
            ("充分。", [[0, 2, 5], [2, 3, None]]),
        ]
        for cue, (sentence, tokens) in zip(self.source["cues"], lesson, strict=True):
            cue.update(japanese=sentence, reading_source=sentence, tokens=tokens)
        self.source["wordIds"].extend(["fully", "enough"])
        self.vocab["words"].extend([
            {"id": "fully", "word": "十分", "reading": "じゅうぶん", "pos": "副詞",
             "romaji": "juubun", "meanings": {"eng": ["sufficiently"]}},
            {"id": "enough", "word": "充分", "reading": "じゅうぶん", "pos": "形状詞",
             "romaji": "juubun", "meanings": {"eng": ["enough"]}},
        ])
        self.source["anchor"] = self.vocab["anchor"] = anchor_identity(self.source["cues"])
        self.review.update(reviewer.identity(
            self.corpus["titles"][0], self.source, self.translation, self.vocab, self.revision,
        ))
        targets = self.review["practice"]["targets"]
        targets[0].update(form="十分", end=2, wordId="fully", choices=["sufficiently", "briefly"])
        targets[1].update(start=2, end=5)
        targets[2].update(form="充分", end=2, wordId="enough", choices=["enough", "never"])
        with self.assertRaisesRegex(ValueError, "Use one mastery entry for"):
            self.finish()
        targets[2]["wordId"] = "fully"
        self.review["practice"]["segments"] = {"c00002": [
            {"start": 0, "end": 2, "form": "充分", "wordId": "fully"},
        ]}
        self.assertEqual(self.finish()["practice"]["cues"][1][5][0][0], "fully")

    def test_duplicate_check_keeps_homographs_and_sense_scoped_entries_separate(self):
        words = {
            "that": {"word": "彼の", "aliases": ["あの"], "reading": "あの", "pos": "連体詞",
                     "meanings": {"eng": ["that"]}},
            "um": {"word": "あの", "reading": "あの", "pos": "感動詞",
                   "meanings": {"eng": ["um"]}},
            "minutes": {"word": "十分", "reading": "じゅっぷん", "pos": "名詞",
                        "meanings": {"eng": ["ten minutes"]}},
            "enough": {"word": "十分", "reading": "じゅうぶん", "pos": "形状詞",
                       "meanings": {"eng": ["enough"]}},
            "tenth": {"word": "十分", "reading": "じゅうぶん", "pos": "名詞",
                      "meanings": {"eng": ["division into ten"]}},
            "some": {"word": "何か", "reading": "なんか", "pos": "代名詞",
                     "meanings": {"eng": ["something"]}},
            "kind-of": {"word": "何か", "reading": "なんか", "pos": "副詞",
                        "meanings": {"eng": ["kind of"]}},
        }
        self.assertEqual(list(duplicate_credits(words)), [])

    def test_whole_expression_rules_keep_longer_forms_and_exact_review_exceptions(self):
        written = "なんというか、じゃあね。"
        tokens = [(a, a + 1, None) for a in range(len(written))]
        spans = expression_spans(written, tokens)
        self.assertEqual([(written[a:b], rule.entry) for a, b, rule in spans], [
            ("なんというか", 2838528),
        ])
        sentence = "猫と言うか迷った。"
        tokens = [(a, a + 1, None) for a in range(len(sentence))]
        spans = expression_spans(sentence, tokens)
        exception = {
            "start": 1, "end": 5, "form": "と言うか", "reason": "Literal choice of wording.",
        }
        self.assertIsNone(validate_expressions(sentence, spans, [], {}, [exception]))
        with_typo = {**exception, "end": 4}
        self.assertEqual(validate_expressions(sentence, spans, [], {}, [with_typo]),
                         "Invalid or stale whole-expression exception")

    def group_pronoun_fixture(self):
        written = "俺達が走った。"
        self.source["cues"][0].update(
            japanese=written, reading_source=written,
            tokens=[[0, 1, 4], [1, 2, 5], [2, 3, 1], [3, 5, 2], [5, 6, 3], [6, 7, None]],
        )
        self.translation["cues"][0]["text"] = "We're the ones who ran."
        self.source["wordIds"].extend(["ore", "tachi"])
        self.vocab["words"].extend([
            {"id": "ore", "word": "俺", "reading": "おれ", "romaji": "ore",
             "pos": "代名詞", "meanings": {"eng": ["I", "me"]}},
            {"id": "tachi", "word": "達", "reading": "たち", "romaji": "tachi",
             "pos": "接尾辞", "meanings": {"eng": []}},
            {"id": "oretachi", "word": "俺たち", "reading": "おれたち", "romaji": "oretachi",
             "pos": "代名詞", "meanings": {"eng": ["we", "us"]}},
        ])
        self.source["anchor"] = self.vocab["anchor"] = anchor_identity(self.source["cues"])
        self.review.update(reviewer.identity(
            self.corpus["titles"][0], self.source, self.translation, self.vocab, self.revision,
        ))
        practice = self.review["practice"]
        practice["targets"][0].update(
            end=2, form="俺達", wordId="oretachi", choices=["we", "I", "they"],
        )
        practice["targets"][1].update(start=3, end=6)
        practice["segments"] = {
            "c00001": [{"start": 0, "end": 2, "form": "俺達", "wordId": "oretachi"}],
        }
        return practice

    def test_group_pronoun_draft_prefers_the_whole_dictionary_entry(self):
        self.group_pronoun_fixture()
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            reviewer.draft(self.corpus, self.vocab, self.revision, path / "whole")
            matches = json.loads((path / "whole/practice-matches.json").read_bytes())
            candidates = matches["cues"]["c00001"]
            self.assertEqual(candidates["groupPronouns"], [
                {"start": 0, "end": 2, "form": "俺達", "candidateWordIds": ["oretachi"]},
            ])
            [group] = [item for item in candidates["preferred"] if item["start"] == 0]
            self.assertEqual(
                (group["kana"], group["romaji"], group["answers"]),
                ("おれたち", "Oretachi", ["we"]),
            )
            self.assertNotIn("俺", [item["form"] for item in candidates["candidates"]])

            self.vocab["words"].pop()
            reviewer.draft(self.corpus, self.vocab, self.revision, path / "missing")
            matches = json.loads((path / "missing/practice-matches.json").read_bytes())
            candidates = matches["cues"]["c00001"]
            self.assertEqual(candidates["groupPronouns"][0]["candidateWordIds"], [])
            self.assertFalse(any(item["start"] < 2 for item in candidates["preferred"]))

    def test_group_pronoun_release_rejects_a_clipped_span_wrong_credit_or_singular_answer(self):
        practice = self.group_pronoun_fixture()
        [_, kana, romaji, _, _, questions] = self.finish()["practice"]["cues"][0]
        [key, hs, he, rs, re, choices, span] = questions[0]
        self.assertEqual((key, kana[hs:he], romaji[rs:re], choices[0], span),
                         ("oretachi", "おれたち", "Oretachi", "we", [0, 2]))
        valid = copy.deepcopy(practice)
        for form, end, key, answer, error in (
            ("俺", 1, "ore", "I", "Highlight the whole group pronoun 俺達"),
            ("俺達", 2, "ore", "we", "Credit 俺達"),
            ("俺達", 2, "oretachi", "I (casual)", "Use a group meaning for 俺達"),
        ):
            with self.subTest(form=form, credit=key, answer=answer):
                practice = self.review["practice"] = copy.deepcopy(valid)
                practice["targets"][0].update(
                    form=form, end=end, wordId=key, choices=[answer, "they"],
                )
                practice["segments"]["c00001"] = [
                    {"start": 0, "end": end, "form": form, "wordId": key},
                ]
                with self.assertRaisesRegex(ValueError, error):
                    self.finish()

        self.review["practice"] = valid
        valid["readings"] = {"c00001": [{
            "start": 0, "end": 2, "form": "俺達", "beforeKana": "おれたち",
            "beforeRomaji": "Oretachi", "kana": "おれたち", "romaji": "Ore",
        }]}
        with self.assertRaisesRegex(ValueError, "Include the tachi ending"):
            self.finish()

    def test_saved_singular_match_cannot_prefill_a_group_pronoun(self):
        practice = self.group_pronoun_fixture()
        self.finish()
        practice["targets"][0].update(form="俺", end=1, wordId="ore", choices=["I", "they"])
        practice["segments"] = {}
        compiled = prepare(self.source, self.translation, self.vocab, practice)
        legacy = {"practice": compiled, "reviewId": "e" * 64}
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            remember(
                path / "matches", self.source, self.translation, self.vocab, self.review, legacy,
            )
            reviewer.draft(self.corpus, self.vocab, self.revision, path / "draft", path / "matches")
            matches = json.loads((path / "draft/practice-matches.json").read_bytes())
            self.assertNotIn("c00001", matches["reusedCues"])
            group = matches["cues"]["c00001"]["groupPronouns"][0]
            self.assertEqual(group["candidateWordIds"], ["oretachi"])

    def test_group_pronouns_respect_adjectival_and_non_pronoun_token_boundaries(self):
        written = "お前らと彼らしい人たち"
        tokens = [(0, 2, None), (2, 3, None), (3, 4, None), (4, 5, None),
                  (5, 8, None), (8, 9, None), (9, 11, None)]
        self.assertEqual(list(group_pronouns(written, tokens, {})), [(0, 3, "お前ら")])
        self.assertEqual(list(group_pronouns("あいつら", [(0, 4, None)], {})), [(0, 4, "あいつら")])
        words = {"honorific": {"pos": "接尾辞/名詞的"}, "otaku": {"pos": "代名詞"}}
        honorific = [(0, 2, None), (2, 3, "honorific"), (3, 5, None)]
        self.assertEqual(list(group_pronouns("鈴木君たち", honorific, words)), [])
        pronoun = [(0, 2, "otaku"), (2, 3, None)]
        self.assertEqual(list(group_pronouns("お宅ら", pronoun, words)), [(0, 3, "お宅ら")])

    def test_subtitle_readings_include_only_explicitly_selected_reviewed_cues(self):
        edit = {"start": 0, "end": 1, "form": "猫", "beforeKana": "ねこ",
                "beforeRomaji": "Neko", "kana": "ネコ", "romaji": "Neko"}
        practice = self.review["practice"]
        practice["readings"] = {cue: [edit] for cue in ("c00001", "c00002")}
        self.assertNotIn("subtitleReadings", self.finish()["practice"])
        practice["subtitleReadingCues"] = ["c00002"]
        self.assertEqual(self.finish()["practice"]["subtitleReadings"], {"c00002": [edit]})
        practice["subtitleReadingCues"] = ["c00003"]
        with self.assertRaisesRegex(ValueError, "must have reviewed Practice readings"):
            self.finish()

    def test_romaji_highlight_keeps_sentence_punctuation_outside_the_word(self):
        text = "えっ? 猫。"
        cue = {"id": "c00002", "japanese": text, "reading_source": text,
               "tokens": [[0, 2, 4], [2, 3, None], [4, 5, 0], [5, 6, None]]}
        self.source["cues"][1].update(cue)
        self.source["anchor"] = self.vocab["anchor"] = anchor_identity(self.source["cues"])
        self.source["wordIds"].append("interjection")
        self.vocab["words"].append({
            "id": "interjection", "word": "えっ", "reading": "えっ", "romaji": "e",
            "pos": "感動詞", "meanings": {"eng": ["huh"]},
        })
        self.translation["cues"][1]["text"] = "Huh? A cat."
        targets = self.review["practice"]["targets"]
        targets[-1].update(start=4, end=5)
        targets.append({"cue": "c00002", "start": 0, "end": 2, "form": "えっ",
                        "wordId": "interjection", "choices": ["huh", "yes"]})
        self.review.update(reviewer.identity(
            self.corpus["titles"][0], self.source, self.translation, self.vocab, self.revision,
        ))

        _, _, romaji, _, _, questions = self.finish()["practice"]["cues"][1]
        self.assertEqual(romaji, "E? neko.")
        self.assertEqual([romaji[q[3]:q[4]] for q in questions], ["E", "neko"])

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
