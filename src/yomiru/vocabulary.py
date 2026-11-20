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
from yomiru.study_vocabulary import excluded_use, speaker_names
from yomiru.translation import digest

ANALYSIS = "unidic-lite-1.0.8-words-v4"
ATTRIBUTION = {
    "name": "JMdict / EDRDG", "url": "https://www.edrdg.org/edrdg/licence.html",
    "copyright": "James William BREEN and the Electronic Dictionary Research and Development Group",
    "license": "CC BY-SA 4.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
}


POS_PREFIXES = {
        "名詞": ("n", "pn", "num", "ctr", "adj-no", "adj-na", "adj-f", "vs", "suf"),
        "代名詞": ("pn",), "動詞": ("v",),
        "形容詞": ("adj-i", "adj-ku", "adj-shiku"),
        "形状詞": ("adj-na", "adj-no", "adj-t", "adj-pn"),
        "助詞": ("prt",), "助動詞": ("aux", "cop"), "副詞": ("adv",), "感動詞": ("int",),
        "接続詞": ("conj",), "接頭辞": ("pref", "n-pref"),
        "接尾辞": ("suf", "n-suf", "ctr", "adj", "aux", "n"),
        "連体詞": ("adj-pn", "adj-no", "adj-na"),
}


def compatible_pos(pos: str, tags: list[str]) -> bool:
    prefixes = POS_PREFIXES.get(pos.split("/")[0])
    return not prefixes or not tags or any(tag.startswith(prefixes) for tag in tags)


def simplified_entries(path):
    """Stream the publisher's line-oriented JSON archive without extracting files."""
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("Supply a regular JMdict archive below 32 MiB")
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
                yield entry


def simplified_meanings(wanted, path):
    for entry in simplified_entries(path):
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
    return analyze_words(rows)[0]


def analyze_words(
    rows: list[dict], *, capture_positions: bool = False, excluded_spans=None,
) -> tuple[list[dict], list[dict]]:
    """Use the same token identities for vocabulary and archived cue positions."""
    def valid(value):
        return value if value and value != "*" else None

    dictionary = Path(unidic_lite.DICDIR)
    romanizer = cutlet.Cutlet(
        use_foreign_spelling=False, ensure_ascii=False,
        mecab_args=f'-d "{dictionary}" -r "{dictionary / "mecabrc"}"',
    )
    romanizer.use_wo = False
    words = {}
    cues = []
    speakers = speaker_names(rows)
    # Speaker annotations also contain roles and sound labels. Only use those
    # spellings for automatic disambiguation when dialogue corroborates a name.
    recurring_names = set()
    if speakers:
        for row in rows:
            written, _ = source_forms(row["japanese"])
            if any(label in written for label in speakers - recurring_names):
                recurring_names.update(
                    token.surface for token in romanizer.tagger(written)
                    if token.surface in speakers and token.feature.pos2 == "固有名詞"
                )
    pending = {cue: set(spans) for cue, spans in (excluded_spans or {}).items()}
    for row in rows:
        written, _ = source_forms(row["japanese"])
        # Romanization parses again with the same tagger. Snapshot all features
        # first: its next parse invalidates the previous native token nodes.
        tokens = [(token.surface, token.feature) for token in romanizer.tagger(written)]
        positions = []
        cursor = 0
        reviewed = pending.get(row["id"])
        for surface, feature in tokens:
            start = written.find(surface, cursor)
            if start < 0:
                raise ValueError(f"Token does not match source cue {row['id']}")
            cursor = start + len(surface)
            if capture_positions:
                positions.append([start, cursor, None])
            span = (start, cursor)
            if reviewed and span in reviewed:
                reviewed.remove(span)
                continue
            if feature.pos1 in {"補助記号", "記号", "空白"} or not re.search(
                r"[\w一-龯ぁ-ヿ]", surface
            ):
                continue
            if excluded_use(surface, feature, written, start, cursor, recurring_names):
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
            if capture_positions:
                positions[-1][2] = key
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
            if kana := valid(feature.kana):
                form_reading = jaconv.kata2hira(kana)
                # Kana spellings already supply a reading in the browser.
                if form_reading != jaconv.kata2hira(surface):
                    form_readings = entry.setdefault("formReadings", [])
                    if form_reading not in form_readings:
                        form_readings.append(form_reading)
            if len(entry["examples"]) < 2 and not any(
                e["cue"] == row["id"] for e in entry["examples"]
            ):
                entry["examples"].append({
                    "cue": row["id"], "start": row["start"], "offset": start, "japanese": written,
                })
        if capture_positions:
            cues.append({"id": row["id"], "start": row["start"], "end": row["end"],
                         "text": written, "tokens": positions,
                         **({"japanese": row["japanese"]} if row["japanese"] != written else {})})
    if any(pending.values()):
        raise ValueError("A reviewed exclusion did not match the exact source token")
    return sorted(words.values(), key=lambda w: w["id"]), cues


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


def attach_vocabulary(index, rows, directory, video_ids, dictionary=None, *, analyzed_words=None):
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
        index, rows, directory, video_ids, dictionary,
        episode=episode, analyzed_words=analyzed_words,
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
    result = attach_vocabulary(index, rows, directory, video_ids, dictionary)
    for track in matching:
        track["anchor"] = result["anchor"]
    index["revision"] = digest({k: index[k] for k in ("tracks", "vocabulary", "registry")})
    commit_index(index_path, index, original)
    return {"episodes": video_ids, "words": result["words"], "anchor": result["anchor"]}
