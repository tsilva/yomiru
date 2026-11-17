import asyncio
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from scripts.translation_review_trial import trial


class ReviewTrialTests(unittest.TestCase):
    def inputs(self, directory):
        draft = directory / "draft.json"
        draft.write_text(json.dumps({"cues": [
            {"id": "c00001", "start": 1100, "end": 2100,
             "japanese": "ここで", "translation": "Please wait here."},
            {"id": "c00002", "start": 2200, "end": 3200,
             "japanese": "待ってください", "translation": "Please."},
        ]}))
        return SimpleNamespace(
            draft_pairs=draft, work_dir=directory / "review", batch_size=64,
            model="codex/gpt-6.1-sol", reasoning_effort="medium",
        )

    def test_automatic_changes_keep_times_and_validated_cache_avoids_another_call(self):
        class Session:
            calls = 0

            async def call_tool(self, name, arguments):
                self.calls += 1
                user = json.loads(arguments["messages"][1]["content"])
                texts = {"c00001": "Here,", "c00002": "please wait."}
                response = json.dumps({"reviews": [
                    {"id": c["id"], "japanese": c["japanese"], "action": "replace",
                     "text": texts[c["id"]], "issue": "cue_scope"} for c in user["cues"]
                ]})
                return SimpleNamespace(isError=False, content=[
                    SimpleNamespace(type="text", text=response),
                ])

        with tempfile.TemporaryDirectory() as temporary:
            args = self.inputs(Path(temporary))
            session = Session()
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(asyncio.run(trial(args, session)), 0)
                self.assertEqual(asyncio.run(trial(args, session)), 0)
            report = json.loads((args.work_dir / "report.json").read_text())
            pairs = json.loads((args.work_dir / "artifacts/pairs.json").read_text())["cues"]
            self.assertEqual(session.calls, 1)
            self.assertEqual(report["cache_hits"], 1)
            self.assertEqual(report["manual_corrections"], 0)
            self.assertEqual([(c["start"], c["end"]) for c in pairs],
                             [(1100, 2100), (2200, 3200)])
            self.assertEqual([c["translation"] for c in pairs], ["Here,", "please wait."])

    def test_service_failure_stops_without_export_or_fallback(self):
        class Session:
            calls = 0

            async def call_tool(self, name, arguments):
                self.calls += 1
                return SimpleNamespace(isError=True, content=[])

        with tempfile.TemporaryDirectory() as temporary:
            args = self.inputs(Path(temporary))
            session = Session()
            self.assertEqual(asyncio.run(trial(args, session)), 1)
            self.assertEqual(session.calls, 1)
            self.assertFalse((args.work_dir / "artifacts").exists())
