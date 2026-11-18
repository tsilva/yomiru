import gzip
import hashlib
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

from yomiru.captions import Cue
from yomiru.publication import publish
from yomiru.registry import correct_meanings, enrich_names, read_asset, rebuild_registry
from yomiru.translation import anchors, export_trial
from yomiru.vocabulary import (
    anchor_identity,
    dictionary_meanings,
    extract_words,
    prepare_vocabulary,
)


class VocabularyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.rows = [{"id": "c00001", "start": 1000, "end": 4000,
                      "japanese": "パンを食べた。パンを食べます。"}]
        self.dictionary = self.root / "JMdict_e.gz"
        with gzip.open(self.dictionary, "wb") as stream:
            stream.write('''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE JMdict [<!ENTITY v1 "verb">]>
<JMdict><entry><k_ele><keb>食べる</keb></k_ele><r_ele><reb>たべる</reb></r_ele>
<sense><pos>&v1;</pos><gloss>to eat</gloss></sense></entry>
<entry><k_ele><keb>食べる</keb></k_ele><r_ele><reb>くべる</reb></r_ele>
<sense><gloss>wrong reading</gloss></sense></entry></JMdict>'''.encode())

    def test_inflections_deduplicate_without_discarding_particles_or_occurrences(self):
        words = extract_words(self.rows)
        eat = [w for w in words if w["word"] == "食べる"]
        self.assertEqual(len(eat), 1)
        self.assertEqual(eat[0]["count"], 2)
        self.assertEqual(eat[0]["reading"], "たべる")
        self.assertEqual(eat[0]["formReadings"], ["たべ"])
        self.assertIn("を", [w["word"] for w in words])
        self.assertNotIn("。", [w["word"] for w in words])
        other = extract_words([{**self.rows[0], "japanese": "食べる。"}])
        self.assertEqual(eat[0]["id"], other[0]["id"])

    def test_dictionary_respects_reading_and_preserves_unknown_words(self):
        words = extract_words(self.rows)
        before = [w["id"] for w in words]
        attribution = dictionary_meanings(words, self.dictionary)
        self.assertEqual(before, [w["id"] for w in words])
        self.assertEqual(next(w for w in words if w["word"] == "食べる")["meanings"],
                         {"eng": ["to eat"]})
        self.assertEqual(attribution["license"], "CC BY-SA 4.0")
        self.assertTrue(any(not w["meanings"] for w in words))

    def test_numeric_literals_and_single_latin_letters_are_not_vocabulary(self):
        sentence = "Ｘ．Ｙ．Ｚ．装置は－０．００８秒で動き、１，２００円です。三回、ゼロ、QZXLMN。"
        words = {w["word"]: w for w in extract_words([{**self.rows[0], "japanese": sentence}])}
        for excluded in {"0", "008", "1", "200", "X", "Y", "Z"}:
            self.assertNotIn(excluded, words)
        for retained in {"秒", "円", "三", "回", "ゼロ", "QZXLMN", "装置"}:
            self.assertIn(retained, words)
        self.assertEqual(words["三"]["reading"], "さん")
        self.assertEqual(words["秒"]["reading"], "びょう")
        self.assertIn("-0.008秒", words["秒"]["examples"][0]["japanese"])

    def test_simplified_archive_handles_final_record_katakana_and_grammatical_role(self):
        entry = {"id": "synthetic", "kanji": [],
                 "kana": [{"text": "パン", "appliesToKanji": ["*"]}],
                 "sense": [{"partOfSpeech": ["n"], "appliesToKanji": ["*"],
                            "appliesToKana": ["*"],
                            "gloss": [{"lang": "eng", "text": "synthetic bread"}]}]}
        content = ('{"words":[\n' + json.dumps(entry, ensure_ascii=False,
                   separators=(",", ":")) + ']\n}').encode()
        archive = self.root / "dictionary.json.tgz"
        with tarfile.open(archive, "w:gz") as target:
            member = tarfile.TarInfo("dictionary.json")
            member.size = len(content)
            target.addfile(member, io.BytesIO(content))
        words = extract_words(self.rows)
        dictionary_meanings(words, archive)
        bread = next(w for w in words if w["word"] == "パン")
        self.assertEqual(bread["meanings"], {"eng": ["synthetic bread"]})

    def test_romanization_cannot_corrupt_later_token_features_or_merge_unknown_words(self):
        sentence = "大きい犬が静かな公園で三回遊べる。明日も犬と遊ぶ。"
        first = {"id": "c00001", "start": 1000, "japanese": sentence}
        once = extract_words([first])
        twice = extract_words([first, {**first, "id": "c00002"}])
        self.assertFalse(any(w["word"] == "*" or w["pos"] == "BOS/EOS" for w in twice))
        self.assertEqual({w["id"]: w["count"] * 2 for w in once},
                         {w["id"]: w["count"] for w in twice})
        self.assertTrue(all(w["word"] and w["reading"] != "*" for w in twice))
        unknown = extract_words([{**first, "japanese": "QZXLMN RSTUVW"}])
        self.assertEqual(len({w["id"] for w in unknown}), 2)
        self.assertNotIn("*", [w["word"] for w in unknown])

    def test_name_resolution_matches_kana_and_preserves_reading_and_kanji_distinctions(self):
        record = {"id": "synthetic", "kanji": [{"text": "根茂良"}],
                  "kana": [{"text": "ねもら", "appliesToKanji": ["*"]}],
                  "translation": [{"type": ["given"],
                                   "translation": [{"lang": "eng", "text": "Nemora"}]}]}
        content = ('{"words":[\n' + json.dumps(record, ensure_ascii=False,
                   separators=(",", ":")) + ']\n}').encode()
        path = self.root / "names.json.tgz"
        with tarfile.open(path, "w:gz") as archive:
            member = tarfile.TarInfo("names.json")
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
        entries = [{"id": str(n), "word": written, "reading": reading,
                    "aliases": [written], "pos": "名詞/固有名詞", "meanings": {},
                    "meaningStatus": {}, "sources": {}}
                   for n, (written, reading) in enumerate([
                       ("ネモラ", "ねもら"), ("根茂良", "ねもる"), ("根森良", "ねもら")])]
        registry = {"entries": entries, "dictionaries": []}
        enrich_names(registry, path)
        self.assertEqual(entries[0]["meanings"]["eng"], ["Nemora (proper name)"])
        self.assertEqual(entries[1]["meanings"], {})
        self.assertEqual(entries[2]["meanings"], {})

    def test_master_correction_updates_one_registry_without_rewriting_episode_references(self):
        source = anchors([Cue(1000, 4000, "パンを食べる。")])
        metadata = {"validation": {"cues": 1, "timestamp_mismatches": 0}}
        export_trial(source, {source[0].id: "A synthetic sentence."}, self.root, metadata)
        pairs = self.root / "pairs.json"
        library = self.root / "library"
        for episode in (1, 2):
            publish(pairs, library, [f"tt123:1:{episode}"], "Source",
                    "https://example.test/source", dictionary=self.dictionary)
        index = json.loads((library / "index.json").read_text())
        registry = read_asset(library, index["registry"])
        eat = next(e for e in registry["entries"] if e["word"] == "食べる")
        for descriptor in index["vocabulary"]:
            document = read_asset(library, descriptor)
            self.assertEqual(document["version"], 2)
            self.assertTrue(all("meanings" not in w and "word" not in w for w in document["words"]))
            occurrence = next(w for w in document["words"] if w["id"] == eat["id"])
            self.assertEqual(occurrence["formReadings"], ["たべる"])
        self.assertNotIn("formReadings", eat)
        corrections = self.root / "corrections.json"
        corrections.write_text(json.dumps({"entries": [{"id": eat["id"], "language": "eng",
            "meanings": ["consume food"], "sourceUrl": "https://example.test/dictionary"}]}))
        correct_meanings(library, corrections)
        changed = json.loads((library / "index.json").read_text())
        self.assertEqual(index["vocabulary"], changed["vocabulary"])
        self.assertEqual(index["tracks"], changed["tracks"])
        self.assertNotEqual(index["registry"], changed["registry"])
        updated = read_asset(library, changed["registry"])
        entry = next(e for e in updated["entries"] if e["id"] == eat["id"])
        self.assertEqual(entry["meanings"]["eng"], ["consume food"])
        rebuild_registry(library, self.root, self.dictionary)
        refreshed = json.loads((library / "index.json").read_text())
        refreshed_entry = next(e for e in read_asset(library, refreshed["registry"])["entries"]
                               if e["id"] == eat["id"])
        self.assertEqual(refreshed_entry["meanings"]["eng"], ["consume food"])
        correction = json.loads(corrections.read_text())
        correction["entries"][0].update(language="por", meanings=["comer"])
        corrections.write_text(json.dumps(correction))
        with self.assertRaisesRegex(ValueError, "language eng"):
            correct_meanings(library, corrections)
        self.assertEqual(refreshed, json.loads((library / "index.json").read_text()))

    def test_translation_and_reading_mode_do_not_change_source_or_vocabulary(self):
        source = anchors([Cue(1000, 4000, self.rows[0]["japanese"])])
        metadata = {"validation": {"cues": 1, "timestamp_mismatches": 0}}
        export_trial(source, {source[0].id: "A synthetic sentence."}, self.root, metadata)
        pairs = self.root / "pairs.json"
        library = self.root / "library"
        publish(pairs, library, ["tt123:1:1"], "Source", "https://example.test/source",
                dictionary=self.dictionary)
        before = json.loads((library / "index.json").read_text())
        data = json.loads(pairs.read_text())
        data["cues"][0]["translation"] = "Uma frase de exemplo."
        pairs.write_text(json.dumps(data))
        publish(pairs, library, ["tt123:1:1"], "Source", "https://example.test/source",
                language="por")
        after = json.loads((library / "index.json").read_text())
        self.assertEqual(before["vocabulary"], after["vocabulary"])
        self.assertEqual(before["registry"], after["registry"])
        self.assertEqual({t["lang"] for t in after["tracks"]}, {"eng", "por"})
        self.assertEqual(len({t["anchor"] for t in after["tracks"]}), 1)
        self.assertEqual(len(after["tracks"]), 8)
        data["cues"][0]["japanese"] = "今日は静かです。"
        pairs.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "Japanese source changed"):
            publish(pairs, library, ["tt123:1:1"], "Source", "https://example.test/source",
                    language="por")
        self.assertEqual(after, json.loads((library / "index.json").read_text()))

    def test_enrichment_requires_exact_generation_and_revisions_track_dictionary(self):
        library = self.root / "library"
        library.mkdir()
        pairs = self.root / "pairs.json"
        pairs.write_text(json.dumps({"cues": self.rows}))
        generation = hashlib.sha256(pairs.read_bytes()).hexdigest()
        index = {"version": 1, "tracks": [{"generation": generation,
                                          "videoIds": ["tt123:1:1"]}]}
        (library / "index.json").write_text(json.dumps(index))
        result = prepare_vocabulary(pairs, library, ["tt123:1:1"], self.dictionary)
        self.assertEqual(result["anchor"], anchor_identity(self.rows))
        pairs.write_text(json.dumps({"cues": [{**self.rows[0], "japanese": "別の言葉"}]}))
        with self.assertRaisesRegex(ValueError, "exact published"):
            prepare_vocabulary(pairs, library, ["tt123:1:1"], self.dictionary)
