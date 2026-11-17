import json
import tempfile
import unittest
from pathlib import Path

from yomiru.captions import Cue
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

    def publish(self, episode="tt1234567:1:1"):
        return publish(
            self.pairs, self.library, [episode], "Synthetic source",
            "https://example.test/captions",
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
