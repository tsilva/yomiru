import asyncio
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.translation_trial import trial

CORPUS = Path(__file__).resolve().parents[1] / "examples/translation/synthetic.json"


class TrialTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict("os.environ", {"YOMIRU_SUBTITLE_TRACE_ENDPOINT": ""}))

    def test_full_context_profile_runs_through_validation_and_export(self):
        class Session:
            async def call_tool(self, name, arguments):
                body = json.loads(arguments["messages"][-1]["content"])
                self.assert_payload = arguments
                text = json.dumps({"translations": [
                    {"id": key, "text": "Translation."} for key in body["target_ids"]
                ]})
                return SimpleNamespace(isError=False, content=[
                    SimpleNamespace(type="text", text=text),
                ])

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            plan = directory / "models.json"
            plan.write_text(json.dumps([{
                "id": "codex/gpt-6.1-sol", "prompt_profile": "full-context",
                "reasoning_effort": "medium",
            }]))
            args = SimpleNamespace(
                corpus=CORPUS, models=plan, fixture=False, work_dir=directory,
                batch_size=8, target="English",
            )
            session = Session()
            with contextlib.redirect_stdout(io.StringIO()):
                result = asyncio.run(trial(args, session))
            report = json.loads((directory / "synthetic-summary.json").read_text())[0]
            self.assertEqual(result, 0)
            self.assertEqual(report["validation"]["timestamp_mismatches"], 0)
            self.assertIs(session.assert_payload["store"], False)
            self.assertNotIn("provider", session.assert_payload)
            self.assertNotIn("max_tokens", session.assert_payload)

    def test_annotated_profile_validates_exports_and_reuses_its_local_cache(self):
        class Session:
            def __init__(self):
                self.messages = []

            async def call_tool(self, name, arguments):
                messages = arguments["messages"]
                self.messages.append(messages)
                ids = messages[-1]["content"].split(": ", 1)[1].split(", ")
                text = "\n".join(f"{cue_id}|Translation." for cue_id in ids)
                return SimpleNamespace(isError=False, content=[
                    SimpleNamespace(type="text", text=text),
                ])

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            plan = directory / "models.json"
            plan.write_text(json.dumps([{
                "id": "codex/gpt-6.2-sol", "prompt_profile": "annotated-full-context",
                "reasoning_effort": "low",
            }]))
            args = SimpleNamespace(
                corpus=CORPUS, models=plan, fixture=False, work_dir=directory,
                batch_size=8, target="English",
            )
            session = Session()
            with contextlib.redirect_stdout(io.StringIO()):
                result = asyncio.run(trial(args, session))
                rerun = asyncio.run(trial(args, session))
            report = json.loads((directory / "synthetic-summary.json").read_text())[0]
            self.assertEqual((result, rerun), (0, 0))
            self.assertGreater(len(session.messages), 1)
            self.assertTrue(all(messages[:-1] == session.messages[0][:-1]
                                for messages in session.messages))
            self.assertEqual(report["cache_hits"], len(session.messages))
            self.assertEqual(report["validation"]["timestamp_mismatches"], 0)

    def run_trial(self, directory, session):
        plan = directory / "models.json"
        plan.write_text(json.dumps([{"id": "test/first"}, {"id": "test/second"}]))
        args = SimpleNamespace(
            corpus=CORPUS, models=plan, fixture=False, work_dir=directory,
            batch_size=32, target="English",
        )
        with contextlib.redirect_stdout(io.StringIO()):
            result = asyncio.run(trial(args, session))
        return result, json.loads((directory / "synthetic-summary.json").read_text())

    def test_invalid_candidate_is_recorded_without_hiding_next_planned_comparison(self):
        class Session:
            async def call_tool(self, name, arguments):
                cues = json.loads(arguments["messages"][1]["content"])["cues"]
                text = '{"translations":[]}' if arguments["model"] == "test/first" else (
                    json.dumps({"translations": [{"id": c["id"], "text": "Translation."}
                                                  for c in cues]})
                )
                return SimpleNamespace(isError=False, content=[
                    SimpleNamespace(type="text", text=text),
                ])

        with tempfile.TemporaryDirectory() as temporary:
            result, reports = self.run_trial(Path(temporary), Session())
            self.assertEqual(result, 1)
            self.assertEqual(len(reports), 2)
            self.assertTrue(reports[0]["errors"])
            self.assertFalse(reports[1]["errors"])
            self.assertEqual(reports[1]["validation"]["timestamp_mismatches"], 0)

    def test_authentication_failure_stops_all_calls_without_switching_models(self):
        class Session:
            calls = 0

            async def call_tool(self, name, arguments):
                self.calls += 1
                return SimpleNamespace(isError=True, content=[
                    SimpleNamespace(type="text", text="OpenRouter error 401: rejected"),
                ])

        with tempfile.TemporaryDirectory() as temporary:
            session = Session()
            result, reports = self.run_trial(Path(temporary), session)
            self.assertEqual(result, 1)
            self.assertEqual(len(reports), 1)
            self.assertEqual(session.calls, 1)
            self.assertIsNone(reports[0]["billed_cost_usd"])
