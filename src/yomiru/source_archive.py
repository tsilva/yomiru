"""Prepare private, content-addressed Japanese source and position assets."""

import gzip
import hashlib
import json
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from yomiru.captions import parse_document
from yomiru.registry import write_immutable_asset
from yomiru.translation import anchors
from yomiru.vocabulary import ANALYSIS, analyze_words, anchor_identity

MAX_SOURCE_BYTES = 2 * 1024 * 1024


def _save(directory: Path, folder: str, suffix: str, data: bytes) -> dict:
    checksum = hashlib.sha256(data).hexdigest()
    path = f"{folder}/{checksum}.{suffix}"
    parent = directory / folder
    parent.mkdir(mode=0o700, exist_ok=True)
    if parent.is_symlink():
        raise ValueError("Source archive directories must not be symlinks")
    write_immutable_asset(directory / path, data)
    return {"path": path, "sha256": checksum, "bytes": len(data)}


def _matches_source(cues, expected):
    # Some published pairs keep all timed events and apply their own display
    # cleanup. Their annotated reading source still matches the parsed input.
    if len(cues) == len(expected) and all(
        (f"c{index:05}", cue.start, cue.end, cue.text)
        == (row["id"], row["start"], row["end"], row["reading_source"])
        for index, (cue, row) in enumerate(zip(cues, expected, strict=True), 1)
    ):
        return True
    return [asdict(cue) for cue in anchors(cues)] == expected


def archive_source(
    source: Path, directory: Path, rows: list[dict], *, published_selection: bool = False,
    excluded_spans=None,
) -> tuple[dict, list[dict]]:
    if directory.is_symlink() or not isinstance(rows, list) or not 1 <= len(rows) <= 15000:
        raise ValueError("Supply a private directory and a complete set of Japanese cues")
    if source.is_symlink() or not source.is_file():
        raise ValueError("Original Japanese subtitles must be a regular file")
    with source.open("rb") as stream:
        raw = stream.read(MAX_SOURCE_BYTES + 1)
    if len(raw) > MAX_SOURCE_BYTES:
        raise ValueError("Original Japanese subtitles must be at most 2 MiB")
    format = source.suffix.lower().lstrip(".")
    parsed = parse_document(raw.decode("utf-8-sig"), format)
    expected = [{key: row.get(key, "") for key in (
        "id", "start", "end", "japanese", "reading_source",
    )} for row in rows]
    excluded_music = False
    used_published_selection = False
    if not _matches_source(parsed, expected):
        spoken = [cue for cue in parsed if "♪" not in cue.text]
        if len(spoken) != len(parsed) and _matches_source(spoken, expected):
            excluded_music = True
        elif published_selection:
            available = Counter((cue.start, cue.end, cue.text) for cue in parsed)
            selected = Counter(
                (row["start"], row["end"], row["reading_source"] or row["japanese"])
                for row in expected
            )
            if selected - available:
                raise ValueError("Published Japanese cues do not match the original subtitle file")
            used_published_selection = True
        else:
            raise ValueError("Original Japanese subtitle cues do not match the translation pairs")

    words, cues = analyze_words(rows, capture_positions=True, excluded_spans=excluded_spans)
    word_ids = [word["id"] for word in words]
    indices = {word_id: i for i, word_id in enumerate(word_ids)}
    for cue in cues:
        for token in cue["tokens"]:
            if token[2] is not None:
                token[2] = indices[token[2]]

    anchor = anchor_identity(rows)
    payload = json.dumps({
        "version": 1, "anchor": anchor, "analysis": ANALYSIS,
        "offsets": "unicode-codepoints", "wordIds": word_ids, "cues": cues,
    }, ensure_ascii=False, separators=(",", ":")).encode()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    original = _save(directory, "sources", format, raw)
    analysis = _save(directory, "analyses", "json.gz", gzip.compress(payload, mtime=0))
    receipt = {
        "version": 1, "anchor": anchor, "original": original, "analysis": analysis,
        "excludedMusic": excluded_music,
    }
    if used_published_selection:
        receipt["publishedSelection"] = True
    manifest = _save(directory, "manifests", "json", json.dumps(receipt, sort_keys=True).encode())
    return {**receipt, "manifest": manifest}, words
