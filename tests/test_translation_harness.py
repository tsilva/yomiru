import unittest
from collections import Counter
from contextlib import nullcontext
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from yomiru.translation import Anchor, TranslationCache
from yomiru.translation_context import request_annotated_context
from yomiru.translation_harness import (
    DEFAULT_MODEL,
    Expansion,
    Limits,
    _limits,
    agentbridge_model_limits,
    execute,
    plan,
)


def count(text):
    return len(text)


def source_cues(size=12):
    return [
        Anchor(f"c{i + 1:05}", i * 2000, i * 2000 + 1000, "ここで待って。" * (i % 3 + 1))
        for i in range(size)
    ]


class Trace:
    def __init__(self):
        self.counts = Counter()

    def stage(self, _stage):
        return nullcontext()


class TranslationHarnessTest(unittest.TestCase):
    def test_plan_preserves_contiguous_coverage_with_balanced_budgets(self):
        source = source_cues()
        request = request_annotated_context(source, [cue.id for cue in source], DEFAULT_MODEL)
        limits = Limits("test", 7000, 4000, 128)
        ranges, visible = plan(
            source,
            request,
            count,
            limits,
            Expansion(2.0, 4),
            minimum_batches=4,
            batch_budget=300,
        )
        self.assertEqual(len(ranges), 4)
        self.assertEqual([item for entry in ranges for item in entry.ids], request["ids"])
        self.assertGreater(visible, count(source[0].japanese))
        for entry in ranges:
            self.assertLessEqual(entry.estimated_output_tokens, 300)
            self.assertLess(entry.input_tokens + entry.estimated_output_tokens, limits.context)

    def test_rejects_unfit_full_context_before_a_model_call(self):
        source = source_cues()
        request = request_annotated_context(source, [cue.id for cue in source], DEFAULT_MODEL)
        with self.assertRaisesRegex(ValueError, "Full Japanese context"):
            plan(source, request, count, Limits("test", 3000, 2000, 128), Expansion(2, 4))

    def test_single_batch_reports_one_model_call_without_warmup(self):
        source = source_cues(2)
        ids = [cue.id for cue in source]
        request = request_annotated_context(source, ids, DEFAULT_MODEL)
        ranges, _ = plan(source, request, count, Limits("test", 7000, 4000, 128), Expansion(2, 4))
        response = {
            "warmup": None,
            "usage": {"input_tokens": 80},
            "batches": [{
                "id": f"{ids[0]}-{ids[-1]}", "status": "completed",
                "output": "\n".join(f"{cue_id}|Wait here." for cue_id in ids),
            }],
        }

        with (
            TemporaryDirectory() as root,
            patch("yomiru.translation_harness.export_trial", return_value={"cues": 2}),
        ):
            trace = Trace()
            result = execute(
                source, request, ranges, {"range_splits": 0}, Path(root),
                workers=1, timeout=60, retries=0, call=lambda _: response, trace=trace,
            )

        self.assertEqual(result["model_calls"], 1)
        self.assertEqual(trace.counts["model_calls"], 1)
        self.assertEqual(result["usage"]["input_tokens"], 80)

    def test_split_invalid_range_and_keep_valid_output(self):
        source = source_cues(4)
        expected = [cue.id for cue in source]
        request = request_annotated_context(source, expected, DEFAULT_MODEL)
        ranges, _ = plan(
            source,
            request,
            count,
            Limits("test", 7000, 4000, 128),
            Expansion(2, 4),
            minimum_batches=2,
            batch_budget=120,
        )
        sent = []

        def call(payload):
            batches = []
            for batch in payload["batches"]:
                ids = batch["prompt"].rsplit(": ", 1)[1].split(", ")
                sent.append(ids)
                output = "\n".join(f"{cue_id}|Wait here." for cue_id in ids)
                if len(sent) == 1:
                    output = output.splitlines()[0]
                batches.append({"id": batch["id"], "status": "completed", "output": output})
            return {"usage": {"input_tokens": 10}, "batches": batches}

        with (
            TemporaryDirectory() as root,
            patch("yomiru.translation_harness.export_trial", return_value={"cues": 4}) as export,
        ):
            summary = execute(
                source,
                request,
                ranges,
                {"range_splits": 0},
                Path(root),
                workers=2,
                timeout=60,
                retries=1,
                call=call,
                trace=Trace(),
            )
        self.assertEqual(list(export.call_args.args[1]), expected)
        self.assertEqual(export.call_args.args[3]["status"], "completed")
        self.assertEqual(summary["range_splits"], 1)
        self.assertEqual(summary["usage"]["input_tokens"], 20)
        successful = set(sent[1])
        self.assertTrue(all(successful.isdisjoint(ids) for ids in sent[2:]))

    def test_validated_ranges_can_be_reused_without_inference(self):
        source = source_cues(4)
        expected = [cue.id for cue in source]
        request = request_annotated_context(source, expected, DEFAULT_MODEL)
        ranges, _ = plan(
            source,
            request,
            count,
            Limits("test", 7000, 4000, 128),
            Expansion(2, 4),
            minimum_batches=2,
            batch_budget=120,
        )

        def call(payload):
            batches = []
            for batch in payload["batches"]:
                ids = batch["prompt"].rsplit(": ", 1)[1].split(", ")
                output = "\n".join(f"{cue_id}|Wait here." for cue_id in ids)
                batches.append({"id": batch["id"], "status": "completed", "output": output})
            return {"usage": {"input_tokens": 10}, "batches": batches}

        with (
            TemporaryDirectory() as root,
            patch("yomiru.translation_harness.export_trial", return_value={"cues": 4}),
        ):
            cache = TranslationCache(Path(root) / "cache")
            common = {"workers": 2, "timeout": 60, "retries": 0, "cache": cache}
            execute(
                source,
                request,
                ranges,
                {"range_splits": 0},
                Path(root) / "first",
                call=call,
                trace=Trace(),
                **common,
            )

            def unexpected(_payload):
                self.fail("A fully cached generation should make no model requests")

            result = execute(
                source,
                request,
                ranges,
                {"range_splits": 0},
                Path(root) / "second",
                call=unexpected,
                trace=Trace(),
                **common,
            )
        self.assertEqual(result["local_cache_hits"], 2)
        self.assertEqual(result["valid_cues"], 4)

    def test_agentbridge_window_is_the_live_planning_authority(self):
        reported = {
            "model": DEFAULT_MODEL,
            "context_window_tokens": 475_000,
            "auto_compact_token_limit": 450_000,
        }
        args = SimpleNamespace(
            model=DEFAULT_MODEL,
            encoding=None,
            context_limit=600_000,
            output_limit=None,
            request_reserve=None,
        )
        with (
            patch("yomiru.translation_harness._agentbridge_json", return_value=reported),
            patch.dict(
                "sys.modules",
                {
                    "tiktoken": SimpleNamespace(
                        encoding_for_model=lambda _model: SimpleNamespace(name="o200k_base"),
                        get_encoding=lambda encoding: encoding,
                    )
                },
            ),
        ):
            metadata = agentbridge_model_limits(8082, DEFAULT_MODEL)
            budget, _ = _limits(args, metadata)
            self.assertEqual(budget.context, 450_000)
            args.context_limit = 300_000
            budget, _ = _limits(args, metadata)
            self.assertEqual(budget.context, 300_000)


class TranslationCommandDefaultsTest(unittest.TestCase):
    def test_default_cli_plans_one_safe_chunk_above_the_old_cap_and_splits_when_needed(self):
        from yomiru.cli import parser

        args = parser().parse_args(["translate", "--source", "source.srt", "--work-dir", "out"])
        self.assertEqual((args.workers, args.min_batches, args.batch_output_budget), (1, 1, None))
        source = [
            Anchor(f"c{i + 1:05}", i * 2000, i * 2000 + 1000, "ここで待って。" * 20)
            for i in range(40)
        ]
        ids = [cue.id for cue in source]
        request = request_annotated_context(source, ids, DEFAULT_MODEL)
        generous = Limits("test", 40000, 20000, 128)
        ranges, _ = plan(source, request, count, generous, Expansion(2, 4))
        self.assertEqual(len(ranges), 1)
        self.assertGreater(ranges[0].estimated_output_tokens, 8192)
        reduced = Limits("test", 40000, 9500, 128)
        ranges, _ = plan(source, request, count, reduced, Expansion(2, 4))
        self.assertGreater(len(ranges), 1)
        self.assertEqual([cue_id for entry in ranges for cue_id in entry.ids], ids)
        safe_output = int(reduced.output * 0.70) - 1024
        self.assertTrue(all(entry.estimated_output_tokens <= safe_output for entry in ranges))
