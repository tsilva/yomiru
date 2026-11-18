import json
import tempfile
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Thread

from yomiru.captions import Cue
from yomiru.portuguese import MODEL
from yomiru.publication import publish
from yomiru.registry import correct_meanings, load_registry
from yomiru.translation import anchors, export_trial


@contextmanager
def agentbridge(reply):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append((self.path, payload))
            items = json.loads(payload["messages"][1]["content"])["words"]
            body = json.dumps({"model": MODEL, "choices": [{"finish_reason": "stop",
                "message": {"content": json.dumps({"glosses": reply(items)})}}]}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    with HTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02})
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}/api/v1", requests
        finally:
            server.shutdown()
            thread.join()


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        source = anchors([Cue(1200, 3200, "今日は静かですね。")])
        metadata = {"model": "fixture", "validation": {
            "cues": 1, "timestamp_mismatches": 0,
        }}
        export_trial(source, {source[0].id: "It is quiet today."}, self.root, metadata)
        self.pairs = self.root / "pairs.json"
        self.library = self.root / "library"

    def publish(self, episode="tt1234567:1:1", **options):
        return publish(
            self.pairs, self.library, [episode], "Synthetic source",
            "https://example.test/captions", **options,
        )

    def test_four_styles_complete_assets_and_idempotent_republication(self):
        result = self.publish()
        self.assertEqual(result["tracks"], 4)
        self.assertEqual(result, self.publish())
        index = json.loads((self.library / "index.json").read_text())
        self.assertEqual(len(index["tracks"]), 4)
        for track in index["tracks"]:
            body = (self.library / Path(track["path"]).name).read_bytes()
            self.assertEqual(len(body), track["bytes"])
            self.assertIn(b"0:00:01.20,0:00:03.20", body)
            self.assertIn(b"PlayResX: 1440", body)
            self.assertNotIn(str(self.root), json.dumps(track))

    def test_new_episode_preserves_prior_coverage(self):
        self.publish()
        self.publish("tt1234567:1:2")
        index = json.loads((self.library / "index.json").read_text())
        self.assertEqual(len(index["tracks"]), 8)

    def test_portuguese_translation_batches_only_missing_episode_glosses(self):
        self.publish()
        index_path = self.library / "index.json"
        before = json.loads(index_path.read_text())
        existing = {w["word"]: w for w in load_registry(before, self.library)["entries"]}
        corrections = self.root / "corrections.json"
        corrections.write_text(json.dumps({"entries": [{"id": existing["今日"]["id"],
            "language": "por", "meanings": ["hoje"], "sourceUrl": "https://example.test/lexicon"}]}))
        correct_meanings(self.library, corrections)
        corrected = load_registry(json.loads(index_path.read_text()), self.library)
        reviewed = next(w for w in corrected["entries"] if w["word"] == "今日")

        def glosses(items):
            return [{"id": item["id"], "gloss": "sossegado" if item["word"] == "静か" else None}
                    for item in reversed(items)]

        with agentbridge(glosses) as (url, requests):
            result = self.publish(language="por", agentbridge_url=url)
            repeat = self.publish("tt1234567:1:2", agentbridge_url=url)

        self.assertEqual(len(requests), 2)
        for path, payload in requests:
            self.assertEqual(path, "/api/v1/chat/completions")
            self.assertEqual(payload["model"], "codex/gpt-6.2-sol")
            self.assertFalse(payload["store"])
            self.assertNotIn("tools", payload)
        first, second = [json.loads(payload["messages"][1]["content"]) for _, payload in requests]
        self.assertEqual(first["cues"], ["今日は静かですね。"])
        first, second = first["words"], second["words"]
        self.assertEqual({w["word"] for w in first}, set(existing) - {"今日"})
        self.assertEqual({w["word"] for w in second}, set(existing) - {"今日", "静か"})
        self.assertEqual(result["portugueseVocabulary"], {
            "requested": len(first), "generated": 1, "unresolved": len(first) - 1,
        })
        self.assertEqual(repeat["portugueseVocabulary"]["generated"], 0)
        after = json.loads(index_path.read_text())
        self.assertEqual(after["vocabulary"][0], before["vocabulary"][0])
        words = {w["word"]: w for w in load_registry(after, self.library)["entries"]}
        self.assertEqual(words["今日"], reviewed)
        self.assertEqual(words["静か"]["meanings"]["por"], ["sossegado"])
        self.assertEqual(words["静か"]["meaningStatus"]["por"], "generated")
        self.assertFalse(words["ね"]["meanings"].get("por"))

    def test_invalid_portuguese_response_leaves_library_index_unchanged(self):
        self.publish()
        index_path = self.library / "index.json"
        before = index_path.read_bytes()
        with agentbridge(lambda items: [{"id": 0, "gloss": "falso"}] * len(items)) as (url, _):
            with self.assertRaisesRegex(ValueError, "Invalid AgentBridge"):
                self.publish(language="por", agentbridge_url=url)
        self.assertEqual(index_path.read_bytes(), before)

    def test_partial_failed_or_changed_times_never_publish(self):
        original = json.loads(self.pairs.read_text())
        for mode in ("failure", "coverage", "time"):
            data = json.loads(json.dumps(original))
            if mode == "failure":
                data["metadata"]["errors"] = ["incomplete"]
            elif mode == "coverage":
                data["metadata"]["validation"]["cues"] = 2
            else:
                data["cues"][0]["end"] = data["cues"][0]["start"]
            self.pairs.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                self.publish()
            self.assertFalse((self.library / "index.json").exists())

    def test_rejects_path_ids_and_credential_bearing_attribution(self):
        with self.assertRaises(ValueError):
            self.publish("../episode")
        with self.assertRaises(ValueError):
            publish(self.pairs, self.library, ["tt1234567:1:1"], "Source",
                    "https://example.test/subs?token=secret")
