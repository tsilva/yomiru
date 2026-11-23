import contextlib
import io
import json
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path
from unittest.mock import patch

from yomiru.captions import Cue
from yomiru.cli import main
from yomiru.translation import atomic_json, srt
from yomiru.translation_harness import load_anchors


class TranslationReviewJobTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.source = root / "source.srt"
        self.pairs = root / "pairs.json"
        self.work = root / "review"
        cues = [Cue(index * 1000, index * 1000 + 800, "試合が終わった。") for index in range(50)]
        self.source.write_text(srt(cues))
        self.draft = {
            "metadata": {"target": "English"},
            "cues": [
                {**asdict(cue), "translation": "The match started."}
                for cue in load_anchors(self.source)
            ],
        }
        atomic_json(self.pairs, self.draft)

    def invoke(self, *options):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return main([
                "review-translation", "--source", str(self.source), "--pairs", str(self.pairs),
                "--work-dir", str(self.work), *options,
            ])

    def load(self, filename="proposals.json"):
        return json.loads((self.work / filename).read_bytes())

    @staticmethod
    def fake_bridge(port, payload, *, fail_second=False):
        batches = []
        for index, batch in enumerate(payload["batches"]):
            packet = json.loads(batch["prompt"].split("Review packet:\n", 1)[1])
            first = packet["cues"][0]
            answer = {
                "reviewed_ids": [row["id"] for row in packet["cues"]],
                "changes": [{
                    "id": first["id"], "japanese": first["japanese"],
                    "text": "The match ended.", "issue": "meaning",
                    "reason": "終わった says that the match ended.",
                }],
                "uncertain": [],
            }
            if index == 1 and fail_second:
                answer["changes"][0]["japanese"] = "別の台詞"
            batches.append({"id": batch["id"], "status": "completed", "output": json.dumps(answer)})
        return {"batches": batches, "usage": {"input_tokens": 123}}

    @patch("yomiru.translation_review_job.agentbridge_call")
    def test_resume_reissues_only_failed_ranges_and_rejects_changed_inputs(self, call):
        call.side_effect = lambda *args: self.fake_bridge(*args, fail_second=True)
        self.assertEqual(self.invoke(), 1)
        report = self.load()
        self.assertEqual(len(report["reviewed_ids"]), 48)
        self.assertEqual(report["pending_batches"], ["c00049-c00050"])
        self.assertEqual(report["changes"][0]["japanese"], "試合が終わった。")
        self.assertEqual(report["usage"]["input_tokens"], 123)

        # The same private inputs and checkpoint can move together.
        moved = self.work.with_name("moved")
        self.work.rename(moved)
        self.work = moved
        call.side_effect = self.fake_bridge
        self.assertEqual(self.invoke("--resume"), 0)
        resumed_batches = call.call_args.args[1]["batches"]
        self.assertEqual([batch["id"] for batch in resumed_batches], report["pending_batches"])
        report = self.load()
        self.assertEqual(len(report["reviewed_ids"]), 50)
        self.assertEqual(report["reused_batches"], 1)
        self.assertEqual(report["model_calls"], 1)
        self.assertEqual(len(report["attempts"]), 2)
        self.assertEqual(json.loads(self.pairs.read_bytes()), self.draft)

        call.reset_mock()
        self.assertEqual(self.invoke("--resume"), 0)
        self.assertEqual(self.load()["model_calls"], 0)
        self.draft["cues"][0]["translation"] = "A match started."
        atomic_json(self.pairs, self.draft)
        self.assertEqual(self.invoke("--resume"), 2)
        call.assert_not_called()

    @patch("yomiru.translation_review_job.agentbridge_call")
    def test_targeted_context_and_tampered_checkpoint(self, call):
        call.side_effect = self.fake_bridge
        bounds = ("--first-cue", "c00013", "--last-cue", "c00013", "--full-context")
        self.assertEqual(self.invoke(*bounds), 0)
        payload = call.call_args.args[1]
        self.assertIn("c00050", payload["shared_context"])
        self.assertNotIn("The match started.", payload["shared_context"])
        self.assertEqual(self.load()["reviewed_ids"], ["c00013"])

        state = self.load("checkpoint.json")
        state["results"]["c00013-c00013"]["output"] = "{}"
        atomic_json(self.work / "checkpoint.json", state)
        call.reset_mock()
        self.assertEqual(self.invoke(*bounds, "--resume"), 2)
        call.assert_not_called()

    @patch("yomiru.translation_review_job.agentbridge_call")
    def test_source_timing_drift_fails_before_any_model_call(self, call):
        self.draft["cues"][0]["end"] += 1
        atomic_json(self.pairs, self.draft)
        self.assertEqual(self.invoke(), 2)
        self.assertFalse(self.work.exists())
        call.assert_not_called()
