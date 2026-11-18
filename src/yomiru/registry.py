"""One versioned master lexicon; episode assets contain occurrences and references."""

import fcntl
import gzip
import hashlib
import io
import json
import re
import tarfile
from pathlib import Path

import jaconv

from yomiru.translation import atomic_json, digest
from yomiru.vocabulary import (
    ANALYSIS,
    ATTRIBUTION,
    anchor_identity,
    dictionary_meanings,
    extract_words,
)

LIMIT = 3 * 1024 * 1024
DECODED_REGISTRY_LIMIT = 16 * 1024 * 1024


def commit_index(path, index, original):
    with path.with_name(".index.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = path.read_bytes() if path.exists() else None
        if current != original:
            raise ValueError("Local publication changed during preparation; rerun against it")
        atomic_json(path, index)


def read_asset(directory, descriptor):
    path = directory / Path(descriptor["path"]).name
    if path.is_symlink() or path.stat().st_size > LIMIT:
        raise ValueError("Invalid local vocabulary asset")
    content = path.read_bytes()
    if (len(content) != descriptor["bytes"]
        or hashlib.sha256(content).hexdigest() != descriptor["sha256"]):
        raise ValueError("Vocabulary integrity check failed")
    if path.name.endswith(".gz"):
        with gzip.GzipFile(fileobj=io.BytesIO(content)) as stream:
            content = stream.read(DECODED_REGISTRY_LIMIT + 1)
        if len(content) > DECODED_REGISTRY_LIMIT:
            raise ValueError("Decompressed registry exceeds the 16 MiB limit")
    return json.loads(content)


def write_asset(directory, document, suffix):
    content = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode()
    extension = f"{suffix}.json"
    if suffix == "registry":
        if len(content) > DECODED_REGISTRY_LIMIT:
            raise ValueError("Decompressed registry exceeds the 16 MiB limit")
        content = gzip.compress(content, mtime=0)
        extension += ".gz"
    if len(content) > LIMIT:
        raise ValueError("Vocabulary asset exceeds the 3 MiB upload limit")
    checksum = hashlib.sha256(content).hexdigest()
    path = directory / f"{checksum}.{extension}"
    if path.is_symlink() or (path.exists() and path.read_bytes() != content):
        raise ValueError("Immutable vocabulary asset differs")
    path.write_bytes(content)
    return {"sha256": checksum, "path": f"/library/{path.name}", "bytes": len(content)}


def merge_entries(registry, words, dictionary=None):
    entries = {entry["id"]: entry for entry in registry["entries"]}
    if dictionary and dictionary not in registry["dictionaries"]:
        registry["dictionaries"].append(dictionary)
    for word in words:
        if word["word"] == "*" or word["pos"] == "BOS/EOS":
            continue
        entry = entries.setdefault(word["id"], {k: word[k] for k in (
            "id", "word", "reading", "romaji", "pos",
        )} | {"aliases": [], "meanings": {}, "sources": {}, "meaningStatus": {}})
        for alias in [word["word"], *word.get("aliases", [])]:
            if alias not in entry["aliases"]:
                entry["aliases"].append(alias)
        for language, meanings in word.get("meanings", {}).items():
            target = entry["meanings"].setdefault(language, [])
            target.extend(m for m in meanings if m not in target)
            if meanings:
                entry["meaningStatus"][language] = word.get("meaningStatus", {}).get(
                    language, "dictionary"
                )
                if dictionary:
                    sources = entry["sources"].setdefault(language, [])
                    if dictionary["sha256"] not in sources:
                        sources.append(dictionary["sha256"])
    registry["entries"] = sorted(entries.values(), key=lambda e: e["id"])


def load_registry(index, directory):
    if index.get("registry"):
        return read_asset(directory, index["registry"])
    registry = {"version": 1, "analysis": ANALYSIS, "entries": [], "dictionaries": []}
    for descriptor in index.get("vocabulary", []):
        document = read_asset(directory, descriptor)
        if document["version"] == 1:
            merge_entries(registry, document["words"], document.get("dictionary"))
    return registry


def save_registry(index, directory, registry):
    registry["entries"].sort(key=lambda e: e["id"])
    registry["dictionaries"].sort(key=lambda d: d["sha256"])
    index["registry"] = {**write_asset(directory, registry, "registry"),
                         "words": len(registry["entries"])}


def save_episode(index, directory, words, anchor, video_ids):
    document = {"version": 2, "anchor": anchor, "analysis": ANALYSIS,
                "words": [{k: word[k] for k in ("id", "count", "forms", "examples")}
                          for word in words]}
    descriptor = {**write_asset(directory, document, "vocabulary"), "anchor": anchor,
                  "videoIds": sorted(set(video_ids)), "words": len(words), "analysis": ANALYSIS}
    index["vocabulary"] = [v for v in index.get("vocabulary", [])
                           if not set(v["videoIds"]) & set(video_ids)] + [descriptor]
    index["vocabulary"].sort(key=lambda v: v["videoIds"])
    return descriptor


def enrich_registry(registry, dictionary, names=None):
    """Resolve once across every known spelling, preserving reading restrictions."""
    lookups = []
    owners = []
    for entry in registry["entries"]:
        for alias in entry["aliases"]:
            variants = [alias]
            if re.fullmatch(r"[ぁ-ゖァ-ヺー]+", alias):
                variants += [jaconv.kata2hira(alias), jaconv.hira2kata(alias)]
            for spelling in dict.fromkeys(variants):
                lookup = {**entry, "word": spelling, "meanings": {}}
                lookups.append(lookup)
                owners.append(entry)
    source = dictionary_meanings(lookups, dictionary)
    if source not in registry["dictionaries"]:
        registry["dictionaries"].append(source)
    for lookup, entry in zip(lookups, owners, strict=True):
        if entry["meaningStatus"].get("eng") == "curated":
            continue
        meanings = lookup["meanings"].get("eng", [])
        if not meanings:
            continue
        target = entry["meanings"].setdefault("eng", [])
        target.extend(m for m in meanings if m not in target)
        entry["meaningStatus"]["eng"] = "dictionary"
        references = entry["sources"].setdefault("eng", [])
        if source["sha256"] not in references:
            references.append(source["sha256"])
    if names:
        enrich_names(registry, names)


def enrich_names(registry, path):
    if path.is_symlink() or path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("Invalid JMnedict archive")
    wanted = {}
    for entry in registry["entries"]:
        if "固有名詞" not in entry["pos"] or entry["meanings"].get("eng"):
            continue
        for alias in entry["aliases"]:
            wanted.setdefault(alias, []).append(entry)
            if re.fullmatch(r"[ぁ-ゖァ-ヺー]+", alias):
                wanted.setdefault(jaconv.kata2hira(alias), []).append(entry)
    source = {**ATTRIBUTION, "name": "JMnedict / EDRDG",
              "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    with tarfile.open(path, "r:gz") as archive:
        members = archive.getmembers()
        if len(members) != 1 or not members[0].isfile() or members[0].size > 180 * 1024 * 1024:
            raise ValueError("Expected one bounded JMnedict JSON file")
        with archive.extractfile(members[0]) as stream:
            for line in stream:
                if len(line) > 2 * 1024 * 1024:
                    raise ValueError("Oversized names entry")
                if not line.startswith(b'{"id":'):
                    continue
                record, _ = json.JSONDecoder().raw_decode(line.decode())
                spellings = [k["text"] for k in record["kanji"] + record["kana"]]
                for spelling in dict.fromkeys(spellings):
                    for entry in wanted.get(spelling, []):
                        if not any(jaconv.kata2hira(k["text"]) == entry["reading"] and (
                            spelling == k["text"] or "*" in k["appliesToKanji"]
                            or spelling in k["appliesToKanji"]
                        ) for k in record["kana"]):
                            continue
                        target = entry["meanings"].setdefault("eng", [])
                        for translation in record["translation"]:
                            for text in translation["translation"]:
                                if text["lang"] == "eng":
                                    value = f"{text['text']} (proper name)"
                                    if value not in target:
                                        target.append(value)
                        if target:
                            entry["meaningStatus"]["eng"] = "proper name"
                            entry["sources"]["eng"] = [source["sha256"]]
    if source not in registry["dictionaries"]:
        registry["dictionaries"].append(source)


def attach_registry_vocabulary(
    index, rows, directory, video_ids, dictionary=None, *, episode=None, agentbridge_url=None,
):
    registry = load_registry(index, directory)
    if episode is None:
        words = extract_words(rows)
        merge_entries(registry, words)
    else:
        words = read_asset(directory, episode)["words"]
    if dictionary:
        enrich_registry(registry, dictionary)
    portuguese = None
    if agentbridge_url is not None:
        from yomiru.portuguese import enrich_portuguese

        portuguese = enrich_portuguese(registry, words, agentbridge_url)
    save_registry(index, directory, registry)
    if episode is None:
        episode = save_episode(index, directory, words, anchor_identity(rows), video_ids)
    return episode, portuguese


def rebuild_registry(directory, pairs_root, dictionary, names=None):
    index_path = directory / "index.json"
    original = index_path.read_bytes()
    index = json.loads(original)
    previous_registry = load_registry(index, directory) if index.get("registry") else None
    pairs = {}
    for path in pairs_root.rglob("pairs.json"):
        if path.is_symlink() or path.stat().st_size > 8 * 1024 * 1024:
            continue
        pairs[hashlib.sha256(path.read_bytes()).hexdigest()] = path
    registry = {"version": 1, "analysis": ANALYSIS, "entries": [], "dictionaries": []}
    episodes = []
    # Resolve exact canonical inputs before changing any published descriptors.
    for descriptor in index.get("vocabulary", []):
        tracks = [t for t in index["tracks"] if t.get("anchor") == descriptor["anchor"]
                  and t.get("generation") in pairs]
        if not tracks:
            raise ValueError(f"Exact Japanese generation unavailable: {descriptor['videoIds']}")
        rows = json.loads(pairs[tracks[0]["generation"]].read_text())["cues"]
        if anchor_identity(rows) != descriptor["anchor"]:
            raise ValueError("Canonical Japanese anchor mismatch")
        words = extract_words(rows)
        merge_entries(registry, words)
        episodes.append((descriptor, words))
    enrich_registry(registry, dictionary, names)
    if previous_registry:
        old_entries = {e["id"]: e for e in previous_registry["entries"]}
        for entry in registry["entries"]:
            old = old_entries.get(entry["id"], {})
            for language, status in old.get("meaningStatus", {}).items():
                if status in {"curated", "generated"}:
                    entry["meanings"][language] = old["meanings"][language]
                    entry["meaningStatus"][language] = status
                    entry["sources"][language] = old["sources"][language]
        for source in previous_registry["dictionaries"]:
            if source not in registry["dictionaries"]:
                registry["dictionaries"].append(source)
    save_registry(index, directory, registry)
    for descriptor, words in episodes:
        save_episode(index, directory, words, descriptor["anchor"], descriptor["videoIds"])
    index["revision"] = digest({k: index[k] for k in ("tracks", "vocabulary", "registry")})
    commit_index(index_path, index, original)
    return {"entries": len(registry["entries"]), "episodes": len(episodes),
            "missingEnglish": sum(not e["meanings"].get("eng") for e in registry["entries"])}


def correct_meanings(directory, corrections):
    """Correct master entries without rewriting episode references or subtitle assets."""
    index_path = directory / "index.json"
    original = index_path.read_bytes()
    index = json.loads(original)
    if not index.get("registry"):
        raise ValueError("Build the master vocabulary registry first")
    if corrections.is_symlink() or corrections.stat().st_size > 1024 * 1024:
        raise ValueError("Invalid master vocabulary corrections file")
    changes = json.loads(corrections.read_text())["entries"]
    if not isinstance(changes, list) or len(changes) > 1000:
        raise ValueError("Supply at most 1000 explicit entry corrections")
    registry = load_registry(index, directory)
    entries = {entry["id"]: entry for entry in registry["entries"]}
    from urllib.parse import urlsplit

    for change in changes:
        if change.get("id") not in entries or not re.fullmatch(r"[a-z]{3}", change["language"]):
            raise ValueError("Correction references an unknown entry or language")
        meanings = change["meanings"]
        if (not isinstance(meanings, list) or not meanings or len(meanings) > 100
            or any(not isinstance(m, str) or not m.strip() or len(m) > 2000 for m in meanings)):
            raise ValueError("Supply explicit, nonempty corrected meanings")
        url = urlsplit(change["sourceUrl"])
        if url.scheme != "https" or not url.hostname or url.username or url.password or url.query:
            raise ValueError("Supply a public HTTPS evidence URL without credentials or a query")
        source = {**ATTRIBUTION, "name": "Yomiru editorial glossary",
                  "copyright": "Yomiru contributors", "url": change["sourceUrl"],
                  "sha256": digest(change)}
        if source not in registry["dictionaries"]:
            registry["dictionaries"].append(source)
        entry = entries[change["id"]]
        language = change["language"]
        entry["meanings"][language] = list(dict.fromkeys(meanings))
        entry["meaningStatus"][language] = "curated"
        entry["sources"][language] = [source["sha256"]]
    save_registry(index, directory, registry)
    index["revision"] = digest({k: index[k] for k in ("tracks", "vocabulary", "registry")})
    commit_index(index_path, index, original)
    return {"corrected": len(changes), "registry": index["registry"]["sha256"]}
