import json
import unittest

from yomiru.captions import Cue
from yomiru.translation import Anchor, anchors, validate_response
from yomiru.translation_context import (
    request_annotated_context,
    request_full_context,
    request_whole_context,
    validate_annotated_response,
)


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
        _, context, batch = request["payload"]["messages"]
        user = json.loads(context["content"])
        self.assertEqual(json.loads(batch["content"]), {"target_ids": ["c00002"]})
        self.assertEqual(len(user["japanese_script"]), 3)
        self.assertEqual(user["japanese_script"][0]["japanese"], "兄が来た。")
        self.assertTrue(all(set(row) == {"id", "japanese"}
                            for row in user["japanese_script"]))
        with self.assertRaises(ValueError):
            validate_response(json.dumps({"translations": [
                {"id": "c00001", "text": "My brother came."},
            ]}), request["ids"])

    def test_script_and_schema_remain_stable_even_when_the_last_batch_is_short(self):
        first = request_full_context(self.source, 0, 2, "codex/gpt-6.2-sol")
        last = request_full_context(self.source, 2, 2, "codex/gpt-6.2-sol")
        a, b = first["payload"], last["payload"]
        self.assertEqual(a["messages"][:-1], b["messages"][:-1])
        self.assertEqual(a["response_format"], b["response_format"])
        self.assertNotEqual(a["messages"][-1], b["messages"][-1])
        self.assertNotEqual(first["key"], last["key"])

    def test_annotated_batches_keep_one_script_before_the_targets(self):
        first = request_annotated_context(self.source, ["c00001"], "codex/gpt-6.2-sol")
        next_batch = request_annotated_context(
            self.source, ["c00002", "c00003"], "codex/gpt-6.2-sol",
        )
        a, b = first["payload"]["messages"], next_batch["payload"]["messages"]
        self.assertEqual(a[:-1], b[:-1])
        self.assertIn("c00001|兄(あに)が来た。", a[1]["content"])
        self.assertEqual(a[1]["content"].count("兄(あに)が来た。"), 1)
        self.assertNotEqual(a[-1], b[-1])
        self.assertNotEqual(first["key"], next_batch["key"])

    def test_responses_api_caches_only_the_stable_prefix(self):
        requests = [request_annotated_context(
            self.source, [cue.id], "gpt-6.2-sol", responses_api=True,
        )["payload"] for cue in self.source[:2]]
        first, second = requests
        self.assertEqual(first["input"][:-1], second["input"][:-1])
        self.assertNotEqual(first["input"][-1], second["input"][-1])
        self.assertEqual(first["prompt_cache_options"], {"mode": "explicit", "ttl": "30m"})
        context = first["input"][1]["content"][0]
        self.assertEqual(context["prompt_cache_breakpoint"], {"mode": "explicit"})
        self.assertIn("c00003|まだ来ていません。", context["text"])
        self.assertIsInstance(first["input"][-1]["content"], str)

    def test_annotated_replies_require_exact_order_and_safe_text(self):
        ids = ["c00001", "c00002"]
        self.assertEqual(validate_annotated_response("c00001|First.\nc00002|Next.\n", ids),
                         {"c00001": "First.", "c00002": "Next."})
        for invalid in ("c00001|First.", "c00001|First.\nc00003|Next.",
                        "c00002|Next.\nc00001|First.", "c00001| \nc00002|Next.",
                        "c00001|<i>First.</i>\nc00002|Next."):
            with self.subTest(response=invalid), self.assertRaises(ValueError):
                validate_annotated_response(invalid, ids)
        with self.assertRaises(ValueError):
            request_annotated_context(self.source, ids[::-1], "codex/gpt-6.2-sol")

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
