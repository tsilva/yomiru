"""Publish Japanese-source vocabulary; dictionary meanings never define word identity."""

import gzip
import hashlib
import json
import re
import tarfile
import xml.etree.ElementTree as ET
from pathlib import Path

import cutlet
import jaconv
import unidic_lite

from yomiru.japanese import source_forms
from yomiru.translation import digest

ANALYSIS = "unidic-lite-1.0.8-words-v3"
NON_LEXICAL_TOKEN = re.compile(r"[+−-]?\d+(?:[.,]\d+)*|[A-Za-z]")
ATTRIBUTION = {
    "name": "JMdict / EDRDG", "url": "https://www.edrdg.org/edrdg/licence.html",
    "copyright": "James William BREEN and the Electronic Dictionary Research and Development Group",
    "license": "CC BY-SA 4.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
}


def compatible_pos(pos: str, tags: list[str]) -> bool:
    prefixes = {
        "名詞": ("n", "pn", "num", "ctr", "adj-no", "adj-na", "adj-f", "vs", "suf"),
        "代名詞": ("pn",), "動詞": ("v",),
        "形容詞": ("adj-i", "adj-ku", "adj-shiku"),
        "形状詞": ("adj-na", "adj-no", "adj-t", "adj-pn"),
        "助詞": ("prt",), "助動詞": ("aux", "cop"), "副詞": ("adv",), "感動詞": ("int",),
        "接続詞": ("conj",), "接頭辞": ("pref", "n-pref"),
        "接尾辞": ("suf", "n-suf", "ctr", "adj", "aux", "n"),
        "連体詞": ("adj-pn", "adj-no", "adj-na"),
    }.get(pos.split("/")[0])
    return not prefixes or not tags or any(tag.startswith(prefixes) for tag in tags)


def simplified_meanings(wanted, path):
    """Stream the publisher's line-oriented JSON archive without extracting files."""
    with tarfile.open(path, "r:gz") as archive:
        members = archive.getmembers()
        if len(members) != 1 or not members[0].isfile() or members[0].size > 160 * 1024 * 1024:
            raise ValueError("Expected one bounded JMdict simplified JSON file")
        with archive.extractfile(members[0]) as stream:
            for line in stream:
                if len(line) > 2 * 1024 * 1024:
                    raise ValueError("JMdict entry exceeds 2 MiB")
                if not line.startswith(b'{"id":'):
                    continue
                entry, _ = json.JSONDecoder().raw_decode(line.decode())
                spellings = [v["text"] for v in entry["kanji"] + entry["kana"]]
                for spelling in dict.fromkeys(spellings):
                    for word in wanted.get(spelling, []):
                        if not any(jaconv.kata2hira(k["text"]) == word["reading"] and (
                            spelling == word["reading"] or "*" in k["appliesToKanji"]
                            or spelling in k["appliesToKanji"]
                        ) for k in entry["kana"]):
                            continue
                        inherited = []
                        for sense in entry["sense"]:
                            inherited = sense["partOfSpeech"] or inherited
                            if not compatible_pos(word["pos"], inherited):
                                continue
                            if ("*" not in sense["appliesToKanji"]
                                and spelling not in sense["appliesToKanji"]):
                                continue
                            if ("*" not in sense["appliesToKana"]
                                and word["reading"] not in [
                                    jaconv.kata2hira(k) for k in sense["appliesToKana"]
                                ]):
                                continue
                            for gloss in sense["gloss"]:
                                if gloss["lang"] == "eng":
                                    meanings = word["meanings"].setdefault("eng", [])
                                    if gloss["text"] not in meanings:
                                        meanings.append(gloss["text"])


def anchor_identity(rows: list[dict]) -> str:
    return digest([{k: row[k] for k in ("id", "start", "end", "japanese")} for row in rows])


def extract_words(rows: list[dict]) -> list[dict]:
    def valid(value):
        return value if value and value != "*" else None

    dictionary = Path(unidic_lite.DICDIR)
    romanizer = cutlet.Cutlet(
        use_foreign_spelling=False, ensure_ascii=False,
        mecab_args=f'-d "{dictionary}" -r "{dictionary / "mecabrc"}"',
    )
    romanizer.use_wo = False
    words = {}
    for row in rows:
        written, _ = source_forms(row["japanese"])
        # Romanization parses again with the same tagger. Snapshot all features
        # first: its next parse invalidates the previous native token nodes.
        tokens = [(token.surface, token.feature) for token in romanizer.tagger(written)]
        for surface, feature in tokens:
            if feature.pos1 in {"補助記号", "記号", "空白"} or not re.search(
                r"[\w一-龯ぁ-ヿ]", surface
            ):
                continue
            # Filter written tokens so Japanese number words and counters survive
            # even when UniDic gives them the same grammatical class as digits.
            if NON_LEXICAL_TOKEN.fullmatch(surface):
                continue
            lemma = valid(feature.lemma) or valid(feature.orthBase) or surface
            # UniDic distinguishes lexemes such as パン-pao; keep that identity,
            # while showing the ordinary written dictionary form to the learner.
            word = lemma.split("-")[0]
            reading = jaconv.kata2hira(
                valid(feature.lForm) or valid(feature.kanaBase) or valid(feature.kana) or surface
            )
            pos = "/".join(p for p in (feature.pos1, feature.pos2) if p and p != "*")
            key = "ja-" + digest([lemma, valid(feature.lForm) or reading, pos])
            if key not in words:
                words[key] = {
                    "id": key, "word": word, "reading": reading,
                    "romaji": romanizer.romaji(reading), "pos": pos,
                    "aliases": list(dict.fromkeys([word, valid(feature.orthBase) or surface])),
                    "forms": [], "count": 0, "meanings": {}, "examples": [],
                }
            entry = words[key]
            for alias in (word, valid(feature.orthBase) or surface):
                if alias not in entry["aliases"]:
                    entry["aliases"].append(alias)
            entry["count"] += 1
            if surface not in entry["forms"]:
                entry["forms"].append(surface)
            if len(entry["examples"]) < 2 and not any(
                e["cue"] == row["id"] for e in entry["examples"]
            ):
                entry["examples"].append({
                    "cue": row["id"], "start": row["start"], "japanese": written,
                })
    return sorted(words.values(), key=lambda w: w["id"])


def dictionary_meanings(words: list[dict], path: Path) -> dict:
    """Read bounded JMdict English data, retaining only matching entries."""
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("Supply a regular JMdict English XML or gzip file below 32 MiB")
    wanted = {}
    for word in words:
        wanted.setdefault(word["word"], []).append(word)
    if path.name.endswith(".json.tgz"):
        simplified_meanings(wanted, path)
        return {**ATTRIBUTION, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rb") as stream:
        # JMdict's DTD defines POS entities; gloss/restriction fields need no DTD.
        # Replace those entity references, without resolving files or external URLs.
        data = stream.read(96 * 1024 * 1024 + 1)
    if len(data) > 96 * 1024 * 1024:
        raise ValueError("JMdict decompressed data exceeds 96 MiB")
    data = re.sub(br"<!DOCTYPE[\s\S]*?\]>", b"", data)
    data = re.sub(br"&(?!(?:amp|lt|gt|apos|quot);)([A-Za-z0-9-]+);", br"\1", data)
    import io

    iterator = ET.iterparse(io.BytesIO(data), events=("start", "end"))
    _, root = next(iterator)
    for event, element in iterator:
        if event != "end" or element.tag != "entry":
            continue
        spellings = [e.text for e in element.findall("k_ele/keb")]
        readings = [e.text for e in element.findall("r_ele/reb")]
        for spelling in dict.fromkeys(spellings + readings):
            for word in wanted.get(spelling, []):
                if word["reading"] not in [jaconv.kata2hira(k) for k in readings]:
                    continue
                meanings = word["meanings"].setdefault("eng", [])
                inherited = []
                for sense in element.findall("sense"):
                    inherited = [e.text for e in sense.findall("pos")] or inherited
                    if not compatible_pos(word["pos"], inherited):
                        continue
                    restricted_words = [e.text for e in sense.findall("stagk")]
                    restricted_readings = [e.text for e in sense.findall("stagr")]
                    if restricted_words and spelling not in restricted_words:
                        continue
                    if restricted_readings and word["reading"] not in [
                        jaconv.kata2hira(k) for k in restricted_readings
                    ]:
                        continue
                    for gloss in sense.findall("gloss"):
                        if gloss.get("{http://www.w3.org/XML/1998/namespace}lang", "eng") == "eng":
                            if gloss.text and gloss.text not in meanings:
                                meanings.append(gloss.text)
        element.clear()
        root.clear()
    return {**ATTRIBUTION, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def attach_vocabulary(index, rows, directory, video_ids, dictionary=None, *, agentbridge_url=None):
    anchor = anchor_identity(rows)
    episode = None
    requested_ids = set(video_ids)
    for existing in index.get("vocabulary", []):
        existing_ids = set(existing["videoIds"])
        if existing_ids & requested_ids and existing["anchor"] != anchor:
            raise ValueError("Japanese source changed; explicitly migrate the episode source first")
        if requested_ids <= existing_ids:
            episode = existing
    from yomiru.registry import attach_registry_vocabulary

    return attach_registry_vocabulary(
        index, rows, directory, video_ids, dictionary, episode=episode,
        agentbridge_url=agentbridge_url,
    )


def prepare_vocabulary(pairs: Path, directory: Path, video_ids: list[str], dictionary: Path):
    """Attach vocabulary only to an exact, already-published generation."""
    from yomiru.registry import commit_index

    index_path = directory / "index.json"
    original = index_path.read_bytes()
    index = json.loads(original)
    pairs_data = pairs.read_bytes()
    generation = hashlib.sha256(pairs_data).hexdigest()
    matching = [t for t in index["tracks"] if t.get("generation") == generation]
    if not matching or not set(video_ids) <= {v for t in matching for v in t["videoIds"]}:
        raise ValueError("Pairs must match the exact published episode generation")
    rows = json.loads(pairs_data)["cues"]
    result, _ = attach_vocabulary(index, rows, directory, video_ids, dictionary)
    for track in matching:
        track["anchor"] = result["anchor"]
    index["revision"] = digest({k: index[k] for k in ("tracks", "vocabulary", "registry")})
    commit_index(index_path, index, original)
    return {"episodes": video_ids, "words": result["words"], "anchor": result["anchor"]}
