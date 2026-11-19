import asyncio
import contextlib
import io
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.translation_trial import trial
from yomiru.subtitle_tracing import RELAY_PATH

CORPUS = Path(__file__).resolve().parents[1] / "examples/translation/synthetic.json"


class SubtitleTracingTests(unittest.TestCase):
    def test_success_cache_and_failure_export_only_metadata(self):
        accepted = []

        class Receiver(BaseHTTPRequestHandler):
            reject = True

            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                if self.path == RELAY_PATH and self.headers["Content-Type"] == "application/json":
                    if not self.reject:
                        accepted.append(json.loads(body))
                    self.send_response(503 if self.reject else 204)
                else:
                    self.send_response(404)
                self.end_headers()

            def log_message(self, *_):
                pass

        class Session:
            calls = 0
            failure = False

            async def call_tool(self, name, arguments):
                assert name == "chat" and arguments["store"] is False
                self.calls += 1
                if self.failure:
                    raise RuntimeError("private upstream error")
                ids = arguments["messages"][-1]["content"].split(": ", 1)[1].split(", ")
                return SimpleNamespace(isError=False, content=[
                    SimpleNamespace(type="text", text="\n".join(
                        f"{cue_id}|private generated text" for cue_id in ids
                    )),
                ])

        with HTTPServer(("127.0.0.1", 0), Receiver) as server:
            worker = threading.Thread(target=server.serve_forever)
            worker.start()
            try:
                endpoint = f"http://127.0.0.1:{server.server_port}{RELAY_PATH}"
                with (
                    tempfile.TemporaryDirectory() as temporary,
                    patch.dict("os.environ", {"YOMIRU_SUBTITLE_TRACE_ENDPOINT": endpoint}),
                    contextlib.redirect_stdout(io.StringIO()),
                    contextlib.redirect_stderr(io.StringIO()),
                ):
                    directory = Path(temporary)
                    plan = directory / "models.json"
                    plan.write_text(json.dumps([{
                        "id": "codex/gpt-6.2-sol", "prompt_profile": "annotated-full-context",
                    }]))
                    args = SimpleNamespace(
                        corpus=CORPUS, models=plan, fixture=False, work_dir=directory,
                        batch_size=8, target="English",
                    )
                    session = Session()
                    self.assertEqual(asyncio.run(trial(args, session)), 0)
                    pending = directory / "traces" / "pending"
                    [receipt] = pending.glob("*.json")
                    self.assertEqual(accepted, [])
                    calls = session.calls

                    Receiver.reject = False
                    self.assertEqual(asyncio.run(trial(args, session)), 0)
                    self.assertEqual(session.calls, calls)
                    self.assertEqual(list(pending.glob("*.json")), [])

                    session.failure = True
                    args.cache_dir = directory / "failure-cache"
                    self.assertEqual(asyncio.run(trial(args, session)), 1)
                    args.corpus = directory / "missing-private-name.json"
                    with self.assertRaises(FileNotFoundError):
                        asyncio.run(trial(args, session))
            finally:
                server.shutdown()
                worker.join(timeout=2)

        expected_keys = {
            "yomiru.outcome", "yomiru.mode", "yomiru.cue_count", "yomiru.cache_hits",
            "yomiru.cache_misses", "yomiru.model_calls", "yomiru.omitted_stages",
        }
        outcomes = []
        trace_ids = set()
        for trace in accepted:
            [resource] = trace["resourceSpans"]
            [scope] = resource["scopeSpans"]
            root, *children = scope["spans"]
            attributes = {entry["key"]: entry["value"] for entry in root["attributes"]}
            self.assertEqual(set(attributes), expected_keys)
            self.assertEqual(root["name"], "Process subtitles")
            self.assertEqual(attributes["yomiru.mode"], {"stringValue": "live"})
            outcome = attributes["yomiru.outcome"]["stringValue"]
            outcomes.append(outcome)
            trace_ids.add(root["traceId"])
            self.assertEqual(root["status"]["code"], 2 if outcome == "failed" else 1)
            if outcome == "cached":
                self.assertEqual(attributes["yomiru.cache_hits"], {"intValue": str(calls)})
                self.assertEqual(attributes["yomiru.model_calls"], {"intValue": "0"})
            if outcome == "success":
                self.assertEqual(receipt.stem, root["traceId"])
            span_ids = {span["spanId"] for span in (root, *children)}
            self.assertTrue(all(child["parentSpanId"] in span_ids for child in children))
            self.assertTrue(all(child["traceId"] == root["traceId"] for child in children))
            self.assertTrue(all(not child["attributes"] for child in children))
        self.assertEqual(outcomes, ["cached", "success", "failed", "failed"])
        self.assertEqual(len(trace_ids), len(accepted))
        wire = json.dumps(accepted, ensure_ascii=False)
        for private_value in (
            "private generated text", "private upstream error", "missing-private-name",
            "codex/gpt-6.2-sol", "synthetic.json", "messages", "exception.message",
        ):
            self.assertNotIn(private_value, wire)
