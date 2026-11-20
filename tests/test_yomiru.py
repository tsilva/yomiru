import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import urlopen

from yomiru.captions import Cue, coalesce, milliseconds, parse_ass, parse_srt
from yomiru.japanese import JapaneseRenderer, Script, source_forms
from yomiru.library import Library
from yomiru.render import Appearance, render_ass
from yomiru.server import make_server
from yomiru.timing import Timing

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


class CaptionTests(unittest.TestCase):
    def test_invalid_times_are_rejected(self):
        for value in ["00:61:00,000", "-1:00:00.00", "00:00:nan", "not a time"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                milliseconds(value)
        with self.assertRaises(ValueError):
            Cue(2000, 1000, "Invalid")

    def test_srt_decodes_entities_without_changing_apostrophes(self):
        cue = parse_srt("1\n00:00:01,050 --> 00:00:02,100\n<b>Don't &amp; won't.</b>\n")[0]
        self.assertEqual((cue.start, cue.end, cue.text), (1050, 2100, "Don't & won't."))

    def test_ass_preserves_commas_and_obeys_the_event_format(self):
        cues = parse_ass(
            "[Events]\nFormat: Start, End, Text\n"
            r"Dialogue: 0:00:01.20,0:00:03.45,{\an8}Hello, world\Nagain" + "\n"
        )
        self.assertEqual(cues, [Cue(1200, 3450, "Hello, world again")])

    def test_overlapping_dialogue_is_combined_without_collisions(self):
        result = coalesce([Cue(1000, 3000, "A"), Cue(2000, 4000, "B")])
        self.assertEqual(
            result, [Cue(1000, 2000, "A"), Cue(2000, 3000, "A / B"), Cue(3000, 4000, "B")]
        )


class ScriptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.renderer = JapaneseRenderer()

    def test_furigana_is_not_used_as_source_spelling(self):
        written, reading = source_forms("（話者）東京(とうきょう)へ行く")
        self.assertEqual(written, "東京へ行く")
        self.assertEqual(reading, "とうきょうへ行く")

    def test_all_script_modes(self):
        for script, expected in {
            Script.JAPANESE: "日本語",
            Script.KANA: "にほんご",
            Script.ROMAJI: "Nihongo",
        }.items():
            with self.subTest(script=script):
                self.assertEqual(self.renderer.render("日本語(にほんご)", script), expected)

    def test_kana_preserves_written_katakana_within_and_between_words(self):
        text = "カフェで消しゴムを買う。"
        self.assertEqual(self.renderer.render(text, Script.KANA), "カフェでけしゴムをかう。")
        self.assertEqual(self.renderer.render(text, Script.JAPANESE), text)
        self.assertEqual(self.renderer.render("𰻞", Script.KANA), "□")
        self.assertEqual(self.renderer.render("𰻞とカフェ", Script.ROMAJI), "□ to kafe")


class RenderingTests(unittest.TestCase):
    def test_language_regions_stay_compact_with_wrapping_in_every_mode_and_geometry(self):
        for width, height in [(1440, 1080), (1920, 1080), (1280, 720), (320, 240)]:
            for script in Script:
                with self.subTest(width=width, height=height, script=script):
                    output = render_ass(
                        [Cue(1000, 4000, "ここで少し休もう。" * 12)],
                        [Cue(1200, 4200, "Let's take a short break here. " * 12)],
                        script, Appearance(width, height),
                    )
                    styles = {}
                    for line in output.splitlines():
                        if line.startswith("Style: "):
                            fields = line.removeprefix("Style: ").split(",")
                            styles[fields[0]] = fields
                    japanese, english = styles["Japanese"], styles["English"]
                    self.assertEqual((japanese[18], english[18]), ("2", "8"))
                    gap = int(english[21]) - (height - int(japanese[21]))
                    self.assertGreater(gap, 0)
                    self.assertLessEqual(gap, max(2, height * 0.005))
                    self.assertIn("0:00:01.00,0:00:04.00,Japanese", output)
                    self.assertIn("0:00:01.20,0:00:04.20,English", output)
                    self.assertIn(r"\N", output)

    def test_styles_geometry_and_source_times_are_preserved(self):
        output = render_ass(
            [Cue(1200, 3400, "日本語")],
            [Cue(1300, 3500, "Japanese")],
            Script.JAPANESE,
            Appearance(),
        )
        self.assertIn("PlayResX: 1440", output)
        self.assertIn("WrapStyle: 0", output)
        self.assertIn("&H00B5EAFF", output)
        self.assertIn("&H00FFE6A8", output)
        self.assertIn("0:00:01.20,0:00:03.40,Japanese", output)
        self.assertIn("0:00:01.30,0:00:03.50,English", output)

    def test_caption_text_cannot_add_ass_override_commands(self):
        output = render_ass(
            [Cue(1000, 2000, r"{\pos(0,0)}日本語")],
            [Cue(1000, 2000, r"{\pos(0,0)}Don't change position")],
            Script.JAPANESE,
            Appearance(),
        )
        self.assertNotIn(r"{\pos", output)
        self.assertNotIn("&#x27;", output)


class LibraryFixture:
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.library = Library(Path(self.temp.name))

    def build(self, **kwargs):
        return self.library.build(
            EXAMPLES / "japanese.srt",
            EXAMPLES / "english.srt",
            "tt0000000:1:1",
            kwargs.pop("script", Script.ROMAJI),
            kwargs.pop("appearance", Appearance()),
            **kwargs,
        )


class LibraryTests(LibraryFixture, unittest.TestCase):
    def test_cache_identity_includes_mode_appearance_and_release(self):
        baseline = self.build()
        self.assertEqual(self.build().key, baseline.key)
        self.assertNotEqual(self.build(script=Script.JAPANESE).key, baseline.key)
        self.assertNotEqual(self.build(appearance=Appearance(1920, 1080)).key, baseline.key)
        self.assertNotEqual(self.build(release_hint="ExampleRelease").key, baseline.key)
        delayed = self.build(timing=Timing(japanese_delay_ms=500))
        self.assertNotEqual(delayed.key, baseline.key)
        provenance = json.loads(
            (self.library.directory / f"{delayed.key}.provenance.json").read_text()
        )
        self.assertEqual(provenance["timing"]["japanese_delay_ms"], 500)

    def test_release_hint_must_match_and_other_episodes_are_excluded(self):
        track = self.build(release_hint="ExampleRelease")
        self.assertEqual(self.library.tracks(track.video_id, "series"), [])
        self.assertEqual(self.library.tracks(track.video_id, "series", "other.mkv"), [])
        self.assertEqual(
            self.library.tracks(track.video_id, "series", "[examplerelease] 01.mkv"), [track]
        )
        self.assertEqual(self.library.tracks("tt0000000:1:2", "series", "ExampleRelease"), [])

    def test_invalid_metadata_and_paths_are_not_served(self):
        (self.library.directory / "broken.json").write_text('{"key": 42}')
        self.assertEqual(self.library.tracks("tt0000000:1:1", "series"), [])
        self.assertIsNone(self.library.subtitle("../../secret"))


class ServerTests(LibraryFixture, unittest.TestCase):
    def test_manifest_subtitles_and_asset_flow(self):
        track = self.build(release_hint="ExampleRelease")
        server = make_server(self.library)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def close():
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

        self.addCleanup(close)
        base = f"http://127.0.0.1:{server.server_port}"
        with urlopen(base + "/manifest.json", timeout=5) as response:
            self.assertEqual(json.load(response)["name"], "Yomiru")
        path = "/subtitles/series/tt0000000:1:1/filename=" + quote("ExampleRelease.mkv") + ".json"
        with urlopen(base + path, timeout=5) as response:
            subtitle = json.load(response)["subtitles"][0]
        self.assertEqual(subtitle["id"], track.key)
        with urlopen(subtitle["url"], timeout=5) as response:
            self.assertIn(b"[V4+ Styles]", response.read())
        with urlopen(base + "/subtitles/series/tt0000000:1:2.json", timeout=5) as response:
            self.assertEqual(json.load(response)["subtitles"], [])
        with self.assertRaises(HTTPError) as caught:
            urlopen(base + "/.env", timeout=5)
        self.assertEqual(caught.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
