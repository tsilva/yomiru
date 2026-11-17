import io
import json
import sqlite3
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import urlopen

from yomiru.discovery import Discovery, captions
from yomiru.japanese import Script
from yomiru.library import Library
from yomiru.network import HttpClient, ProviderError, Redirects, validate_url
from yomiru.providers import (
    Candidate,
    Episode,
    Kitsunekko,
    archive_members,
    episode_matches,
    with_aliases,
)
from yomiru.server import make_server
from yomiru.timing import Timing

JA = "1\n00:00:01,000 --> 00:00:03,000\n映画を見ます。\n"
EN = "1\n00:00:01,100 --> 00:00:03,100\nI'll watch a film.\n"


def zipped(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, value in files.items():
            archive.writestr(name, value)
    return buffer.getvalue()


class FakeClient:
    def __init__(self, *, japanese=True, english=True):
        self.japanese, self.english = japanese, english
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append(url)
        parts = urlsplit(url)
        if parts.hostname == "v3-cinemeta.strem.io":
            return json.dumps({"meta": {"name": "Example Anime", "year": "2020"}}).encode()
        if parts.hostname == "opensubtitles-v3.strem.io":
            rows = [
                {"id": "broken", "lang": "eng", "url": "https://subs5.strem.io/broken"},
                {"id": "good", "lang": "eng", "url": "https://subs5.strem.io/good"},
            ]
            return json.dumps({"subtitles": rows if self.english else []}).encode()
        if parts.hostname == "subs5.strem.io":
            return EN.encode() if parts.path == "/good" else b"<html>Not subtitles</html>"
        if parts.hostname == "graphql.anilist.co":
            return b'{"data":{"Page":{"media":[]}}}'
        if parts.path.endswith(".zip"):
            return zipped(
                {"Example - 01.ja.srt": JA, "Example - 02.ja.srt": JA, "Example OP1.srt": JA}
            )
        directory = parse_qs(parts.query).get("dir", [""])[0]
        if directory == "subtitles/japanese/" and self.japanese:
            return (
                b'<a href="/dirlist.php?dir=subtitles%2Fjapanese%2FExample+Anime%2F">'
                b"Example Anime</a>"
            )
        if directory == "subtitles/japanese/Example Anime/":
            return (
                b'<a href="subtitles/japanese/Example%20Anime/Pack.zip">Pack.zip</a>'
                b'<a href="https://evil.invalid/episode01.srt">External</a>'
            )
        return b""

    def json(self, url, **kwargs):
        return json.loads(self.get(url, **kwargs))


class ProviderTests(unittest.TestCase):
    def test_episode_numbering_rejects_other_seasons_and_specials(self):
        episode = Episode("tt0000000:1:1", "series", ("Example",), 1, 1)
        for name in ["Example S01E01.srt", "Example - 01v2.ass", "第01話.srt"]:
            self.assertTrue(episode_matches(name, episode), name)
        for name in [
            "Example S02E01.srt",
            "Example - 02.ass",
            "Example OP1.srt",
            "Example 2020 1080.srt",
            "Example - 11.srt",
        ]:
            self.assertFalse(episode_matches(name, episode), name)
        second = Episode("tt0000000:2:1", "series", ("Example",), 2, 1)
        self.assertFalse(episode_matches("Example - 01.srt", second))
        self.assertTrue(episode_matches("Example - 01.srt", second, seasonal_folder=True))

    def test_zip_members_are_filtered_without_extracting_paths(self):
        data = zipped(
            {"01.srt": JA, "02.ass": "[Events]", "font.ttf": "font", "huge.srt": "a" * 5_000_000}
        )
        self.assertEqual(archive_members(data), ["01.srt", "02.ass"])
        with self.assertRaises(ProviderError):
            archive_members(b"not a zip")

    def test_directory_search_uses_exact_title_and_selected_zip_episode(self):
        episode = Episode("tt0000000:1:1", "series", ("Example Anime",), 1, 1)
        rows = Kitsunekko(FakeClient()).search(episode, "jpn")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].member, "Example - 01.ja.srt")
        self.assertEqual(captions(FakeClient(), rows[0])[0].text, "映画を見ます。")
        different = Episode("tt0000001:1:1", "series", ("Example Anime Sequel",), 1, 1)
        self.assertEqual(Kitsunekko(FakeClient()).search(different, "jpn"), [])

    def test_search_aliases_skip_spinoffs_and_wrong_years(self):
        client = FakeClient()
        client.json = lambda *args, **kwargs: {
            "data": {
                "Page": {
                    "media": [
                        {
                            "title": {"english": "Example Anime Mini", "romaji": "Mini"},
                            "seasonYear": 2020,
                        },
                        {
                            "title": {"english": "Example Anime", "romaji": "Old"},
                            "seasonYear": 1990,
                        },
                        {
                            "title": {"english": "Example Anime", "romaji": "Rei Anime"},
                            "seasonYear": 2020,
                        },
                    ]
                }
            }
        }
        episode = Episode("tt0000000:1:1", "series", ("Example Anime",), 1, 1, 2020)
        result = with_aliases(client, episode)
        self.assertIn("Rei Anime", result.titles)
        self.assertNotIn("Old", result.titles)
        self.assertNotIn("Mini", result.titles)

    def test_download_addresses_and_redirects_cannot_reach_local_services(self):
        for url in [
            "http://kitsunekko.net/file",
            "https://127.0.0.1/file",
            "https://kitsunekko.net@evil.invalid/a",
            "file:///etc/passwd",
            "https://kitsunekko.net:8808/a",
            "https://evil.invalid/a",
        ]:
            with self.subTest(url=url), self.assertRaises(ProviderError):
                validate_url(url)
        with self.assertRaises(ProviderError):
            Redirects().redirect_request(None, None, 302, "", {}, "http://127.0.0.1/private")

    def test_shift_jis_japanese_and_html_failures(self):
        candidate = Candidate("Kitsunekko", "jpn", "https://kitsunekko.net/a.srt", "a.srt")
        client = FakeClient()
        client.get = lambda *a, **k: JA.encode("cp932")
        self.assertEqual(captions(client, candidate)[0].text, "映画を見ます。")
        client.get = lambda *a, **k: b"<html>error page</html>"
        with self.assertRaises(ProviderError):
            captions(client, candidate)


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.library = Library(Path(self.temp.name) / "library")
        self.client = FakeClient()
        self.discovery = Discovery(self.library, tuple(Script), client=self.client)

    def test_listing_is_lazy_and_chosen_source_survives_restart(self):
        selections, status = self.discovery.search("tt0000000:1:1", "series", {})
        self.assertEqual(status["status"], "available")
        self.assertEqual(len(selections), 8)
        self.assertFalse(any("subs5" in url for url in self.client.calls))
        chosen = next(s for s in selections if s.base.filename.endswith("good"))
        output = self.discovery.generate(chosen.key)
        self.assertIn(b"[V4+ Styles]", output)
        self.assertIn(b"I'll watch a film.", output)
        first_count = len(self.client.calls)
        self.assertEqual(self.discovery.generate(chosen.key), output)
        self.assertEqual(len(self.client.calls), first_count)
        restarted = Discovery(self.library, tuple(Script), client=self.client)
        self.assertEqual(restarted.generate(chosen.key), output)
        next_selections, _ = restarted.search("tt0000000:1:1", "series", {})
        next_chosen = next(s for s in next_selections if s.base.filename.endswith("good"))
        count = len(self.client.calls)
        self.assertEqual(restarted.generate(next_chosen.key), output)
        self.assertEqual(len(self.client.calls), count)

    def test_failed_selected_source_does_not_switch_to_another_track(self):
        selections, _ = self.discovery.search("tt0000000:1:1", "series", {})
        chosen = next(s for s in selections if s.base.filename.endswith("broken"))
        with self.assertRaisesRegex(ProviderError, "selected subtitle source is unavailable"):
            self.discovery.generate(chosen.key)
        self.assertFalse(any(url.endswith("/good") for url in self.client.calls))

    def test_sparse_base_is_rejected_then_hidden_without_extra_listing_downloads(self):
        def document(count, text):
            return "\n\n".join(
                f"{i + 1}\n00:{i // 10:02}:{i % 10 * 6:02},000 --> "
                f"00:{i // 10:02}:{i % 10 * 6 + 3:02},000\n{text}"
                for i in range(count)
            )

        class CachedClient(FakeClient):
            def __init__(self):
                super().__init__()
                self.bodies = {}

            def get(self, url, **kwargs):
                result = super().get(url, **kwargs)
                if urlsplit(url).hostname == "opensubtitles-v3.strem.io":
                    result = json.dumps({"subtitles": [{
                        "id": "good", "lang": "eng", "url": "https://subs5.strem.io/good"
                    }]}).encode()
                elif url.endswith(".zip"):
                    result = zipped({"Example - 01.ja.srt": document(120, "日本語")})
                elif url.endswith("/good"):
                    result = document(8, "Sign").encode()
                self.bodies[url] = result
                return result

            def peek(self, url):
                return self.bodies.get(url)

        client = CachedClient()
        discovery = Discovery(self.library, client=client)
        offered, _ = discovery.search("tt0000000:1:1", "series", {})
        self.assertEqual(len(offered), 1)
        self.assertFalse(any("subs5" in url for url in client.calls))
        with self.assertRaisesRegex(ProviderError, "too little dialogue"):
            discovery.generate(offered[0].key)
        self.assertEqual(len(discovery.results), 1)  # Retain bounded eviction bookkeeping.
        self.assertEqual(list(self.library.directory.glob("*.ass")), [])
        offered, status = discovery.search("tt0000000:1:1", "series", {})
        self.assertEqual(offered, [])
        self.assertEqual(status["status"], "unavailable")
        self.assertIn("sparse", status["warnings"][0])

    def test_requested_base_language_does_not_fall_back_to_english(self):
        discovery = Discovery(self.library, client=self.client, base_language="por")
        selections, status = discovery.search("tt0000000:1:1", "series", {})
        self.assertEqual(selections, [])
        self.assertIn("por", status["message"])

    def test_missing_languages_return_no_fake_track_and_retries_are_cached(self):
        for ja, en, language in [(False, True, "Japanese"), (True, False, "English")]:
            client = FakeClient(japanese=ja, english=en)
            discovery = Discovery(self.library, client=client)
            selections, status = discovery.search("tt0000000:1:1", "series", {})
            self.assertEqual(selections, [])
            self.assertIn(language, status["message"])
            count = len(client.calls)
            discovery.search("tt0000000:1:1", "series", {})
            self.assertEqual(len(client.calls), count)

    def test_request_identity_changes_with_release_and_episode(self):
        first, _ = self.discovery.search("tt0000000:1:1", "series", {"filename": "one.mkv"})
        second, _ = self.discovery.search("tt0000000:1:1", "series", {"filename": "two.mkv"})
        other, _ = self.discovery.search("tt0000000:1:2", "series", {"filename": "one.mkv"})
        self.assertNotEqual(first[0].key, second[0].key)
        self.assertNotEqual(first[0].key, other[0].key)
        self.assertEqual(other[0].japanese.member, "Example - 02.ja.srt")

    def test_invalid_id_and_provider_failure_are_explicit(self):
        rows, status = self.discovery.search("../../etc/passwd", "series", {})
        self.assertEqual(rows, [])
        self.assertIn("Unsupported episode ID", status["message"])
        self.client.json = lambda *a, **k: (_ for _ in ()).throw(ProviderError("Provider HTTP 429"))
        rows, status = self.discovery.search("tt0000000:1:1", "series", {})
        self.assertEqual(rows, [])
        self.assertEqual(status["message"], "Provider HTTP 429")

    def test_timing_options_have_distinct_discovery_assets(self):
        aligned, _ = self.discovery.search("tt0000000:1:1", "series", {})
        original = Discovery(
            self.library, tuple(Script), client=self.client, timing=Timing()
        )
        unchanged, _ = original.search("tt0000000:1:1", "series", {})
        self.assertNotEqual(aligned[0].key, unchanged[0].key)
        chosen = next(s for s in aligned if s.base.filename.endswith("good"))
        generated = self.discovery.generate(chosen.key).decode()
        self.assertIn("; Yomiru-Timing:", generated)
        self.assertIn('"status": "uncertain"', generated)

    def test_stremio_request_generates_selected_track_and_does_not_leak_cached_releases(self):
        server = make_server(self.library, discovery=self.discovery)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def cleanup():
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

        self.addCleanup(cleanup)
        base = f"http://127.0.0.1:{server.server_port}"
        with urlopen(
            base + "/subtitles/series/tt0000000:1:1/filename=one.mkv.json", timeout=5
        ) as r:
            data = json.load(r)
        self.assertEqual(len(data["subtitles"]), 8)
        chosen = next(row for row in data["subtitles"] if "track good" in row["label"])
        self.assertIn("OpenSubtitles", chosen["label"])
        with urlopen(chosen["url"], timeout=5) as r:
            self.assertIn(b"Style: Japanese", r.read())
        with urlopen(
            base + "/subtitles/series/tt0000000:1:1/filename=two.mkv.json", timeout=5
        ) as r:
            different = json.load(r)
        ids = {s["id"] for s in data["subtitles"]}
        self.assertFalse(ids & {s["id"] for s in different["subtitles"]})
        with self.assertRaises(HTTPError) as error:
            urlopen(base + "/generate/" + "0" * 64 + ".ass", timeout=5)
        self.assertEqual(error.exception.code, 404)


class HttpCacheTests(unittest.TestCase):
    def test_size_cap_persistent_cache_and_eviction(self):
        with tempfile.TemporaryDirectory() as directory:
            client = HttpClient(Path(directory), budget=8)

            class Response(io.BytesIO):
                url = "https://kitsunekko.net/a"

            with patch("yomiru.network.build_opener") as opener:
                opener.return_value.open.side_effect = lambda *a, **k: Response(b"12345")
                self.assertEqual(client.get("https://kitsunekko.net/a"), b"12345")
                self.assertEqual(client.get("https://kitsunekko.net/a"), b"12345")
                self.assertEqual(client.peek("https://kitsunekko.net/a"), b"12345")
                self.assertIsNone(client.peek("https://kitsunekko.net/missing"))
                with self.assertRaises(ProviderError):
                    client.peek("https://kitsunekko.net/a", limit=3)
                self.assertEqual(opener.return_value.open.call_count, 1)
                client.get("https://kitsunekko.net/b")
                with sqlite3.connect(client.path) as db:
                    self.assertEqual(db.execute("SELECT COUNT(*) FROM cache").fetchone()[0], 1)
                with self.assertRaises(ProviderError):
                    client.get("https://kitsunekko.net/c", limit=3)


if __name__ == "__main__":
    unittest.main()
