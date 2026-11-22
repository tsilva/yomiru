import gzip
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

from yomiru.captions import Cue
from yomiru.cli import main
from yomiru.japanese import Script
from yomiru.publication import publish
from yomiru.translation import anchors, export_trial


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

    def test_three_modes_complete_assets_and_idempotent_republication(self):
        result = self.publish()
        self.assertEqual(result["tracks"], 3)
        self.assertEqual(result, self.publish())
        index = json.loads((self.library / "index.json").read_text())
        self.assertCountEqual(
            [track["script"] for track in index["tracks"]], ["romaji", "kana", "japanese"]
        )
        for track in index["tracks"]:
            body = (self.library / Path(track["path"]).name).read_bytes()
            self.assertTrue(track["playbackReady"])
            self.assertEqual(len(body), track["bytes"])
            self.assertIn(b"0:00:01.20,0:00:03.20", body)
            self.assertIn(b"PlayResX: 1440", body)
            self.assertIn(rb"Japanese,,0,0,0,,{\pos(720,896)}", body)
            self.assertIn(rb"English,,0,0,0,,{\pos(720,900)}", body)
            self.assertNotIn(str(self.root), json.dumps(track))

    def test_new_episode_preserves_prior_coverage(self):
        self.publish()
        self.publish("tt1234567:1:2")
        index = json.loads((self.library / "index.json").read_text())
        self.assertEqual(len(index["tracks"]), 6)

    def test_movie_preparation_creates_matching_vocabulary_from_the_japanese_cues(self):
        movie = "tt1234567"
        self.publish(movie, media_type="movie", reading_mode=Script.ROMAJI)
        index = json.loads((self.library / "index.json").read_text())
        track, = index["tracks"]
        self.assertEqual((track["lang"], track["script"]), ("eng", "romaji"))
        rendered = (self.library / Path(track["path"]).name).read_text()
        self.assertIn("Style: Japanese,", rendered)
        self.assertIn("Style: English,", rendered)
        self.assertIn("It is quiet today.", rendered)
        entry, = index["vocabulary"]
        vocabulary = json.loads((self.library / Path(entry["path"]).name).read_bytes())
        self.assertEqual(entry["videoIds"], [movie])
        self.assertGreater(len(vocabulary["words"]), 0)
        self.assertEqual({track["anchor"] for track in index["tracks"]}, {entry["anchor"]})

    def test_standalone_romaji_cli_publishes_one_track_and_matching_japanese_vocabulary(self):
        original = self.root / "source.srt"
        original.write_text(
            "1\n00:00:01,200 --> 00:00:03,200\n今日は静かですね。\n", encoding="utf-8",
        )
        archive = self.root / "private"
        movie = "tt1234567"
        with redirect_stdout(StringIO()) as output:
            self.assertEqual(main([
                "publish", "--romaji-only", "--japanese-source", str(original),
                "--archive-dir", str(archive), "--video-id", movie, "--type", "movie",
                "--source-label", "Synthetic source", "--source-url", "https://example.test/captions",
                "--data-dir", str(self.library),
            ]), 0)
        result = json.loads(output.getvalue())
        index = json.loads((self.library / "index.json").read_text())
        track, = index["tracks"]
        vocabulary, = index["vocabulary"]
        self.assertEqual((track["lang"], track["script"]), ("jpn", "romaji"))
        self.assertEqual(track["anchor"], vocabulary["anchor"])
        self.assertEqual(vocabulary["videoIds"], [movie])
        self.assertGreater(vocabulary["words"], 0)
        self.assertEqual(track["anchor"], result["source_archive"]["anchor"])
        self.assertEqual(
            (archive / result["source_archive"]["original"]["path"]).read_bytes(),
            original.read_bytes(),
        )
        subtitle = (self.library / Path(track["path"]).name).read_text()
        dialogue, = [line for line in subtitle.splitlines() if line.startswith("Dialogue:")]
        self.assertIn(",Japanese,,", dialogue)
        self.assertIn("shizuka", dialogue)
        self.assertNotIn("静か", dialogue)
        self.assertNotIn("Style: English", subtitle)

    def test_standalone_romaji_reuses_a_published_cue_selection_and_keeps_older_tracks(self):
        movie = "tt1234567"
        self.publish(movie, media_type="movie")
        prior = json.loads((self.library / "index.json").read_text())
        original = self.root / "source.srt"
        original.write_text(
            "1\n00:00:01,200 --> 00:00:03,200\n今日は静かですね。\n\n"
            "2\n00:00:04,000 --> 00:00:05,000\n次回の予告\n", encoding="utf-8",
        )
        options = {
            "media_type": "movie", "romaji_only": True,
            "japanese_source": original, "archive_directory": self.root / "private",
        }
        result = self.publish(movie, **options)
        self.assertTrue(result["source_archive"]["publishedSelection"])
        self.assertEqual(result, self.publish(movie, **options))
        index = json.loads((self.library / "index.json").read_text())
        self.assertEqual({track["anchor"] for track in index["tracks"]},
                         {prior["vocabulary"][0]["anchor"]})
        self.assertEqual(index["vocabulary"], prior["vocabulary"])
        self.assertEqual([track for track in index["tracks"] if track["lang"] == "eng"],
                         prior["tracks"])

    def test_private_source_archive_preserves_every_occurrence_and_reuses_objects(self):
        original = self.root / "source.srt"
        source = anchors([Cue(i * 1000, i * 1000 + 900, "駅まで歩いた。") for i in range(3)])
        original.write_text("\n\n".join(
            f"{i + 1}\n00:00:0{i},000 --> 00:00:0{i},900\n駅まで歩いた。" for i in range(3)
        ), encoding="utf-8")
        export_trial(source, {cue.id: "I walked to the station." for cue in source}, self.root,
                     {"validation": {"cues": 3, "timestamp_mismatches": 0}})
        archive = self.root / "private"
        options = {"japanese_source": original, "archive_directory": archive}
        receipt = self.publish(**options)["source_archive"]
        self.assertEqual(self.publish(**options)["source_archive"], receipt)
        archived_source = archive / receipt["original"]["path"]
        self.assertEqual(archived_source.read_bytes(), original.read_bytes())
        analysis = json.loads(gzip.decompress((archive / receipt["analysis"]["path"]).read_bytes()))
        self.assertEqual([cue["id"] for cue in analysis["cues"]], [cue.id for cue in source])
        word_ids = []
        for cue in analysis["cues"]:
            word_ids.extend(analysis["wordIds"][index] for start, end, index in cue["tokens"]
                            if index is not None and cue["text"][start:end] == "歩い")
        self.assertEqual(len(word_ids), 3)
        self.assertEqual(len(set(word_ids)), 1)
        public_index = (self.library / "index.json").read_text()
        entry, = json.loads(public_index)["vocabulary"]
        vocabulary = json.loads((self.library / Path(entry["path"]).name).read_bytes())
        reference = next(word for word in vocabulary["words"] if word["id"] == word_ids[0])
        self.assertEqual(reference["count"], 3)
        self.assertEqual(len(reference["examples"]), 2)
        self.assertNotIn(receipt["analysis"]["sha256"], public_index)

    def test_private_archive_rejects_wrong_source_and_public_storage_path(self):
        wrong = self.root / "wrong.srt"
        wrong.write_text("1\n00:00:01,200 --> 00:00:03,200\n雪が降った。\n", encoding="utf-8")
        archive = self.root / "private"
        with self.assertRaisesRegex(ValueError, "do not match"):
            self.publish(japanese_source=wrong, archive_directory=archive)
        self.assertFalse(archive.exists())
        self.assertFalse((self.library / "index.json").exists())
        with self.assertRaisesRegex(ValueError, "separate private source archive"):
            self.publish(japanese_source=wrong, archive_directory=self.library / "private")

    def test_backfill_accepts_published_dialogue_from_the_original_and_keeps_all_source_bytes(self):
        original = self.root / "source.srt"
        original.write_text(
            "1\n00:00:01,200 --> 00:00:03,200\n今日は静かですね。\n\n"
            "2\n00:00:04,000 --> 00:00:05,000\n次回の予告\n", encoding="utf-8",
        )
        archive = self.root / "private"
        with self.assertRaisesRegex(ValueError, "do not match"):
            self.publish(japanese_source=original, archive_directory=archive)
        with redirect_stdout(StringIO()) as output:
            self.assertEqual(main([
                "archive-source", "--pairs", str(self.pairs), "--japanese-source", str(original),
                "--archive-dir", str(archive),
            ]), 0)
        receipt = json.loads(output.getvalue())["source_archive"]
        self.assertTrue(receipt["publishedSelection"])
        archived = archive / receipt["original"]["path"]
        self.assertEqual(archived.read_bytes(), original.read_bytes())
        self.assertFalse((self.library / "index.json").exists())

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
