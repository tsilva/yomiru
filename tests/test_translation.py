import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from yomiru.captions import Cue, parse_srt
from yomiru.translation import (
    Anchor,
    TranslationCache,
    anchors,
    export_trial,
    normalize_overlapping_repeats,
    paired_cues,
    request_batch,
    validate_response,
)


class TranslationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.source = anchors([
            Cue(1203, 3417, "日本語(にほんご)を勉強する。"),
            Cue(4201, 6539, "まだ三分もある。"),
        ])
        self.response = json.dumps({"translations": [
            {"id": "c00001", "text": "I study Japanese."},
            {"id": "c00002", "text": "We still have a whole three minutes."},
        ]})

    def test_anchor_timestamps_stay_exact_and_model_never_receives_timestamps(self):
        request = request_batch(self.source, 0, 24, "test/model")
        user = json.loads(request["payload"]["messages"][1]["content"])
        self.assertEqual(set(user["cues"][0]), {"id", "japanese"})
        self.assertNotIn("1203", json.dumps(request["payload"]))
        translated = validate_response(self.response, request["ids"])
        ja, en = paired_cues(self.source, translated)
        self.assertEqual([(c.start, c.end) for c in ja], [(1203, 3417), (4201, 6539)])
        self.assertEqual([(c.start, c.end) for c in ja], [(c.start, c.end) for c in en])
        self.assertEqual(self.source[0].japanese, "日本語を勉強する。")
        self.assertEqual(ja[0].text, "日本語(にほんご)を勉強する。")

    def test_missing_duplicate_unknown_blank_and_timestamp_mutations_are_rejected(self):
        rows = json.loads(self.response)["translations"]
        invalid = [
            {"translations": rows[:1]},
            {"translations": [rows[0], rows[0]]},
            {"translations": [rows[0], {"id": "unknown", "text": "Bad"}]},
            {"translations": [rows[0], {"id": "c00002", "text": " "}]},
            {"translations": [rows[0], {**rows[1], "start": 0}]},
            {"translations": [rows[0], {**rows[1], "text": r"{\pos(0,0)}Bad"}]},
            {"translations": rows, "timestamps": []},
        ]
        for body in invalid:
            with self.subTest(body=body), self.assertRaises(ValueError):
                validate_response(json.dumps(body), [c.id for c in self.source])
        with self.assertRaises(ValueError):
            validate_response("```json\n" + self.response + "\n```", [c.id for c in self.source])

    def test_response_order_cannot_change_pairings(self):
        rows = json.loads(self.response)["translations"]
        translated = validate_response(json.dumps({"translations": rows[::-1]}),
                                       [c.id for c in self.source])
        _, target = paired_cues(self.source, translated)
        self.assertEqual(target[0].text, "I study Japanese.")
        self.assertEqual(target[1].text, "We still have a whole three minutes.")

    def test_cache_identity_covers_source_times_language_model_prompt_context_and_revision(self):
        request = request_batch(self.source, 0, 24, "test/model")
        variants = [
            request_batch(self.source, 0, 24, "test/other"),
            request_batch(self.source, 0, 24, "test/model", "Portuguese"),
            request_batch(self.source, 0, 24, "test/model", glossary={"日本語": "Japanese"}),
            request_batch(self.source, 0, 24, "test/model", model_revision="new-version"),
            request_batch(self.source, 0, 24, "test/model", reasoning_effort="none"),
            request_batch([Anchor("c00001", 1204, 3417, "日本語を勉強する。"),
                           self.source[1]], 0, 24, "test/model"),
        ]
        self.assertTrue(all(v["key"] != request["key"] for v in variants))
        with patch("yomiru.translation.SYSTEM", "A revised translation prompt"):
            revised = request_batch(self.source, 0, 24, "test/model")
        self.assertNotEqual(request["key"], revised["key"])
        cache = TranslationCache(self.directory / "cache")
        self.assertIsNone(cache.get(request))
        expected = cache.put(request, self.response)
        self.assertEqual(TranslationCache(cache.directory).get(request), expected)
        for variant in variants:
            self.assertIsNone(cache.get(variant))
        with self.assertRaises(ValueError):
            cache.put({**request, "key": "../../outside"}, self.response)

    def test_invalid_results_do_not_enter_cache_and_corruption_is_a_miss(self):
        request = request_batch(self.source, 0, 24, "test/model")
        cache = TranslationCache(self.directory / "cache")
        with self.assertRaises(ValueError):
            cache.put(request, '{"translations":[]}')
        self.assertFalse(cache.directory.exists())
        cache.put(request, self.response)
        (cache.directory / f"{request['key']}.json").write_text("broken")
        self.assertIsNone(cache.get(request))

    def test_two_workers_reuse_one_validated_generation(self):
        request = request_batch(self.source, 0, 24, "test/model")
        cache = TranslationCache(self.directory / "cache")
        calls = []

        def worker():
            with cache.claim(request):
                result = cache.get(request)
                if result is None:
                    calls.append("simulated model call")
                    result = cache.put(request, self.response)
                return result

        with ThreadPoolExecutor(max_workers=2) as pool:
            first, second = list(pool.map(lambda _: worker(), range(2)))
        self.assertEqual(first, second)
        self.assertEqual(len(calls), 1)

    def test_export_pairs_and_html_escaping_are_verifiable(self):
        translated = validate_response(self.response, [c.id for c in self.source])
        report = export_trial(self.source, translated, self.directory, {"mode": "test fixture"})
        ja = parse_srt((self.directory / "japanese.srt").read_text())
        en = parse_srt((self.directory / "translated.srt").read_text())
        self.assertEqual([(c.start, c.end) for c in ja], [(c.start, c.end) for c in en])
        self.assertEqual(report["timestamp_mismatches"], 0)
        pairs = json.loads((self.directory / "pairs.json").read_text())
        self.assertEqual(pairs["metadata"]["validation"], report)
        self.assertIn("Style: English", (self.directory / "paired.ass").read_text())
        self.assertIn("review", (self.directory / "review.html").read_text().lower())
        self.assertFalse(report["audio_verified"])

    def test_context_cues_are_not_translation_targets(self):
        source = [Anchor(f"c{i:05}", i * 3000, i * 3000 + 2000, "日本語")
                  for i in range(1, 9)]
        request = request_batch(source, 3, 2, "test/model")
        user = json.loads(request["payload"]["messages"][1]["content"])
        self.assertEqual(request["ids"], ["c00004", "c00005"])
        self.assertEqual([c["id"] for c in user["context_only"]],
                         ["c00001", "c00002", "c00003", "c00006", "c00007", "c00008"])

    def test_isolated_request_cannot_return_context_as_another_target(self):
        source = [Anchor(f"c{i:05}", i * 3000, i * 3000 + 2000, text)
                  for i, text in enumerate(("今日の午後、", "駅に行きます。", "一人で。"), 1)]
        request = request_batch(source, 1, 1, "test/model")
        user = json.loads(request["payload"]["messages"][1]["content"])
        self.assertEqual(user["cues"], [{"id": "c00002", "japanese": "駅に行きます。"}])
        self.assertEqual([c["position"] for c in user["context_only"]], ["before", "after"])
        self.assertEqual(validate_response('{"translations":[{"id":"c00002",'
                                           '"text":"I am going to the station."}]}',
                                           request["ids"]),
                         {"c00002": "I am going to the station."})
        with self.assertRaises(ValueError):
            validate_response('{"translations":[{"id":"c00001",'
                              '"text":"This afternoon,"}]}', request["ids"])

    def test_only_identical_overlapping_source_repeats_share_a_translation(self):
        source = [Anchor("c00001", 1000, 4000, "この子には無理。"),
                  Anchor("c00002", 2000, 3000, "この子には無理。"),
                  Anchor("c00003", 3100, 3500, "この子には無理。"),
                  Anchor("c00004", 4000, 4500, "この子には無理。"),
                  Anchor("c00005", 5000, 6000, "この子には無理。")]
        result, changes = normalize_overlapping_repeats(source, {
            "c00001": "This child cannot do it.", "c00002": "She cannot do it.",
            "c00003": "He cannot do it.", "c00004": "Nobody can do it.",
            "c00005": "They cannot do it.",
        })
        self.assertEqual(result["c00002"], result["c00001"])
        self.assertEqual(result["c00003"], result["c00001"])
        self.assertEqual(result["c00004"], result["c00001"])
        self.assertEqual(result["c00005"], "They cannot do it.")
        self.assertEqual(len(changes), 3)
