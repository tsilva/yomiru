import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from yomiru.captions import parse_document
from yomiru.compose import compose
from yomiru.discovery import Discovery
from yomiru.library import Library
from yomiru.server import make_server

JA = "1\n00:00:01,000 --> 00:00:03,000\n映画を見ます。\n"
BASE = "WEBVTT\n\nchosen\n00:01.250 --> 00:03.750 align:start\n<i>Veré una película.</i>\n"


class ComposeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.library = Library(Path(self.temp.name) / "library")
        self.payload = {
            "video_id": "tt0000000:1:1",
            "base": {"text": BASE, "format": "vtt"},
            "japanese": {"text": JA, "format": "srt"},
        }

    def test_selected_track_language_and_timings_survive_composition(self):
        track = compose(self.library, self.payload)
        text = self.library.subtitle(track.key).decode()
        self.assertIn("Veré una película.", text)
        self.assertIn("0:00:01.25,0:00:03.75,English", text)
        self.assertIn("0:00:01.00,0:00:03.00,Japanese", text)
        self.assertNotIn("映画", text)
        self.assertEqual(compose(self.library, self.payload).key, track.key)
        self.payload["base"]["text"] = BASE.replace("película", "serie")
        self.assertNotEqual(compose(self.library, self.payload).key, track.key)

    def test_bad_documents_and_non_japanese_upper_track_are_rejected(self):
        for text, format in [
            ("WEBVTT\n\nNOTE ignore\n\n", "vtt"),
            ("not subtitles", "srt"),
            ("<html>error</html>", "html"),
        ]:
            with self.subTest(format=format), self.assertRaises(ValueError):
                parse_document(text, format)
        self.payload["japanese"]["text"] = JA.replace("映画を見ます。", "Only English")
        with self.assertRaisesRegex(ValueError, "no Japanese"):
            compose(self.library, self.payload)

    def test_selected_pair_accepts_independent_timing_adjustments(self):
        self.payload["timing"] = {"japanese_delay_ms": 500, "base_delay_ms": -250}
        track = compose(self.library, self.payload)
        text = self.library.subtitle(track.key).decode()
        self.assertIn("0:00:01.50,0:00:03.50,Japanese", text)
        self.assertIn("0:00:01.00,0:00:03.50,English", text)
        self.payload["timing"] = {"japanese_delay_ms": float("inf")}
        with self.assertRaises(ValueError):
            compose(self.library, self.payload)

    def test_user_base_does_not_require_an_upstream_english_candidate(self):
        from test_discovery import FakeClient

        discovery = Discovery(self.library, client=FakeClient(english=False))
        del self.payload["japanese"]
        track = compose(self.library, self.payload, discovery)
        self.assertIn("Veré una película.", self.library.subtitle(track.key).decode())
        self.assertFalse(any("opensubtitles" in u for u in discovery.client.calls))

    def test_http_caption_pair_to_ass_and_packaged_icon(self):
        server = make_server(self.library)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def cleanup():
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

        self.addCleanup(cleanup)
        base = f"http://127.0.0.1:{server.server_port}"
        request = Request(
            base + "/api/compose",
            data=json.dumps(self.payload).encode(),
            headers={"Content-Type": "application/json", "Origin": "https://web.stremio.com"},
        )
        with urlopen(request, timeout=5) as response:
            asset = json.load(response)["url"]
        with urlopen(asset, timeout=5) as response:
            self.assertIn("Veré una película.", response.read().decode())
        asynchronous = Request(
            base + "/api/compose",
            data=json.dumps({**self.payload, "async": True}).encode(),
            headers={"Content-Type": "application/json", "Origin": "https://web.stremio.com"},
        )
        with urlopen(asynchronous, timeout=5) as response:
            self.assertEqual(response.status, 202)
            self.assertEqual(
                response.headers["Access-Control-Allow-Origin"], "https://web.stremio.com"
            )
            job = json.load(response)["job"]
        for _ in range(100):
            with urlopen(base + "/api/compose/" + job, timeout=5) as response:
                progress = json.load(response)
            if progress["state"] != "pending":
                break
            time.sleep(0.01)
        self.assertEqual(progress["state"], "ready")
        self.assertEqual(progress["url"], asset)
        with urlopen(base + "/manifest.json", timeout=5) as response:
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], "*")
            icon = json.load(response)["logo"]
        with urlopen(icon, timeout=5) as response:
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], "*")
            png = response.read()
            self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
            self.assertEqual(int.from_bytes(png[16:20], "big"), 256)
        bad = Request(
            base + "/api/compose",
            data=b"{}",
            headers={"Content-Type": "application/json", "Origin": "https://evil.invalid"},
        )
        with self.assertRaises(HTTPError) as error:
            urlopen(bad, timeout=5)
        self.assertEqual(error.exception.code, 403)
