import json
import unittest

from yomiru.captions import Cue
from yomiru.translation import Anchor, anchors, validate_response
from yomiru.translation_context import request_full_context, request_whole_context


class FullContextTests(unittest.TestCase):
    def test_whole_file_requires_every_id_beyond_the_batch_limit(self):
        source = [Anchor(f"c{i:05}", i * 3000, i * 3000 + 2000, f"短い文{i}")
                  for i in range(1, 81)]
        request = request_whole_context(source, "codex/gpt-6.1-sol", reasoning_effort="medium")
        body = json.loads(request["payload"]["messages"][1]["content"])
        self.assertEqual(len(body["target_ids"]), 80)
        self.assertEqual(len(body["japanese_script"]), 80)
        schema = request["payload"]["response_format"]["json_schema"]["schema"]
        self.assertEqual(schema["properties"]["translations"]["minItems"], 80)
        partial = {"translations": [{"id": cue.id, "text": "Short sentence."}
                                    for cue in source[:64]]}
        with self.assertRaises(ValueError):
            validate_response(json.dumps(partial), request["ids"])
        complete = {"translations": [{"id": cue.id, "text": "Short sentence."} for cue in source]}
        self.assertEqual(len(validate_response(json.dumps(complete), request["ids"])), 80)

    def test_whole_profile_rejects_duplicate_anchors_and_unselected_backends(self):
        with self.assertRaises(ValueError):
            request_whole_context(self.source, "openrouter/default")
        with self.assertRaises(ValueError):
            request_whole_context([self.source[0], self.source[0]], "codex/gpt-6.1-sol")

    def setUp(self):
        self.source = anchors([
            Cue(1000, 2000, "兄(あに)が来た。"),
            Cue(2200, 3000, "そうですか。"),
            Cue(3500, 5000, "まだ来ていません。"),
        ])

    def test_context_cannot_become_output_and_readings_and_times_stay_private(self):
        request = request_full_context(self.source, 1, 1, "codex/gpt-6.1-sol")
        user = json.loads(request["payload"]["messages"][1]["content"])
        self.assertEqual(user["target_ids"], ["c00002"])
        self.assertEqual(len(user["japanese_script"]), 3)
        self.assertEqual(user["japanese_script"][0]["japanese"], "兄が来た。")
        self.assertTrue(all(set(row) == {"id", "japanese"}
                            for row in user["japanese_script"]))
        with self.assertRaises(ValueError):
            validate_response(json.dumps({"translations": [
                {"id": "c00001", "text": "My brother came."},
            ]}), request["ids"])

    def test_codex_routing_does_not_receive_openrouter_only_options(self):
        request = request_full_context(
            self.source, 0, 2, "codex/gpt-6.1-sol", reasoning_effort="medium",
        )
        self.assertNotIn("provider", request["payload"])
        self.assertNotIn("temperature", request["payload"])
        self.assertEqual(request["payload"]["reasoning_effort"], "medium")
        openrouter = request_full_context(self.source, 0, 2, "test/other")
        self.assertIn("provider", openrouter["payload"])

    def test_distant_context_and_reasoning_changes_invalidate_cached_results(self):
        request = request_full_context(self.source, 2, 1, "codex/gpt-6.1-sol")
        changed = anchors([Cue(1000, 2000, "姉が来た。"),
                           Cue(2200, 3000, "そうですか。"),
                           Cue(3500, 5000, "まだ来ていません。")])
        self.assertNotEqual(request["key"], request_full_context(
            changed, 2, 1, "codex/gpt-6.1-sol",
        )["key"])
        self.assertNotEqual(request["key"], request_full_context(
            self.source, 2, 1, "codex/gpt-6.1-sol", reasoning_effort="high",
        )["key"])
