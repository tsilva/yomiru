"""Build an administrator-managed public library from validated translation pairs."""

import hashlib
import json
import re
from dataclasses import asdict
from pathlib import Path
from urllib.parse import urlsplit

from yomiru.captions import Cue, parse_document
from yomiru.japanese import Script
from yomiru.registry import commit_index, write_immutable_asset
from yomiru.render import Appearance, render_ass
from yomiru.source_archive import MAX_SOURCE_BYTES, archive_source
from yomiru.translation import Anchor, anchors, validate_response
from yomiru.vocabulary import anchor_identity, attach_vocabulary

FORMAT = 1
MAX_PAIRS_BYTES = 8 * 1024 * 1024
IDENTIFIER = re.compile(r"[A-Za-z0-9_.:-]{1,200}")


def load_pairs(path: Path) -> tuple[bytes, dict]:
    if path.is_symlink() or path.stat().st_size > MAX_PAIRS_BYTES:
        raise ValueError("Translation pairs exceed the input limit or are a symlink")
    contents = path.read_bytes()
    return contents, json.loads(contents)


def _japanese_rows(source: Path) -> list[dict]:
    if source.is_symlink() or not source.is_file():
        raise ValueError("Original Japanese subtitles must be a regular file")
    with source.open("rb") as stream:
        raw = stream.read(MAX_SOURCE_BYTES + 1)
    if len(raw) > MAX_SOURCE_BYTES:
        raise ValueError("Original Japanese subtitles must be at most 2 MiB")
    cues = parse_document(raw.decode("utf-8-sig"), source.suffix.lower().lstrip("."))
    return [asdict(cue) for cue in anchors(cues)]


def publish(
    pairs_path: Path | None,
    directory: Path,
    video_ids: list[str],
    source_label: str,
    source_url: str,
    *,
    media_type: str = "series",
    language: str | None = None,
    dictionary: Path | None = None,
    japanese_source: Path | None = None,
    archive_directory: Path | None = None,
    romaji_only: bool = False,
) -> dict:
    """Add one complete episode; raw inputs and inference traces remain private."""
    if not video_ids or any(not IDENTIFIER.fullmatch(v) for v in video_ids):
        raise ValueError("Supply exact episode IDs, not URLs or paths")
    if language is None:
        language = "jpn" if romaji_only else "eng"
    if romaji_only and language != "jpn":
        raise ValueError("Standalone romaji must use the Japanese subtitle language")
    if media_type not in {"series", "movie"} or not re.fullmatch(r"[a-z]{3}", language):
        raise ValueError("Invalid media type or three-letter language")
    if (japanese_source is None) != (archive_directory is None):
        raise ValueError("Provide both the Japanese subtitle file and private archive directory")
    if romaji_only and japanese_source is None:
        raise ValueError("Standalone romaji requires the Japanese source and private archive")
    if pairs_path is None and not romaji_only:
        raise ValueError("Bilingual publication requires translation pairs")
    if archive_directory is not None:
        public_root, archive_root = directory.resolve(), archive_directory.resolve()
        if (
            archive_directory.is_symlink() or archive_root.is_relative_to(public_root)
            or public_root.is_relative_to(archive_root)
        ):
            raise ValueError("Use a separate private source archive and publication directory")
    if not source_label.strip() or len(source_label) > 160 or any(
        ord(c) < 32 for c in source_label
    ):
        raise ValueError("Supply a short public source label")
    url = urlsplit(source_url)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query:
        raise ValueError("Source attribution must be a public HTTPS URL without credentials")
    if pairs_path is None:
        rows = _japanese_rows(japanese_source)
    else:
        pairs_data, document = load_pairs(pairs_path)
        rows = document["cues"]
    if not isinstance(rows, list) or not 1 <= len(rows) <= 15000:
        raise ValueError("A complete nonempty episode is required")
    if pairs_path is not None:
        metadata = document.get("metadata", {})
        validation = metadata.get("validation", {})
        if (
            metadata.get("errors") or metadata.get("failures")
            or validation.get("cues") != len(rows)
            or validation.get("timestamp_mismatches") != 0
        ):
            raise ValueError("Only complete structurally validated translation pairs can publish")
    ids = [row["id"] for row in rows]
    if romaji_only:
        if len(set(ids)) != len(rows):
            raise ValueError("Japanese cue IDs must be unique")
        translations = {}
    else:
        translations = validate_response(json.dumps({"translations": [
            {"id": row["id"], "text": row["translation"]} for row in rows
        ]}), ids)
    japanese, translated = [], []
    for row in rows:
        start, end = row["start"], row["end"]
        if (
            type(start) is not int or type(end) is not int
            or not 0 <= start < end <= 24 * 60 * 60 * 1000
            or not isinstance(row["japanese"], str) or not row["japanese"].strip()
        ):
            raise ValueError("Invalid Japanese anchor or cue times")
        reading_source = row.get("reading_source") or row["japanese"]
        if romaji_only:
            Anchor(row["id"], start, end, row["japanese"], reading_source)
        japanese.append(Cue(start, end, reading_source))
        if not romaji_only:
            translated.append(Cue(start, end, translations[row["id"]]))
    directory.mkdir(parents=True, exist_ok=True)
    index_path = directory / "index.json"
    original = index_path.read_bytes() if index_path.exists() else None
    index = json.loads(original) if original is not None else {
        "version": FORMAT, "tracks": [],
    }
    if index.get("version") != FORMAT or not isinstance(index.get("tracks"), list):
        raise ValueError("Unsupported published library")
    anchor = anchor_identity(rows)
    for previous in index["tracks"]:
        if set(previous["videoIds"]) & set(video_ids) and previous.get("anchor", anchor) != anchor:
            raise ValueError("Japanese source changed; explicitly migrate the episode source first")
    source_archive, words = None, None
    if japanese_source is not None and archive_directory is not None:
        source_archive, words = archive_source(
            japanese_source, archive_directory, rows,
            published_selection=romaji_only and pairs_path is not None,
        )
    attach_vocabulary(index, rows, directory, video_ids, dictionary, analyzed_words=words)
    # Use the complete generation identity privately; export only safe public fields.
    generation = (source_archive["manifest"]["sha256"] if romaji_only
                  else hashlib.sha256(pairs_data).hexdigest())
    new_tracks = []
    for script in (Script.ROMAJI,) if romaji_only else Script:
        content = render_ass(
            japanese, translated, script, Appearance(),
            base_label=None if romaji_only else "AI translation",
        ).encode("utf-8")
        checksum = hashlib.sha256(content).hexdigest()
        filename = f"{checksum}.ass"
        write_immutable_asset(directory / filename, content)
        identity = hashlib.sha256(json.dumps(
            [sorted(set(video_ids)), media_type, language, script.value, generation, checksum],
        ).encode()).hexdigest()
        new_tracks.append({
            "id": identity, "videoIds": sorted(set(video_ids)), "type": media_type,
            "lang": language, "script": script.value, "sha256": checksum,
            "path": f"/library/{filename}", "bytes": len(content), "cues": len(rows),
            "source": {"label": source_label, "url": source_url},
            "timing": "Japanese source times; video synchronization unverified",
            "translation": ("Japanese romanization; administrator published" if romaji_only
                            else "AI generated; administrator published"),
            "generation": generation,
            "anchor": anchor,
        })
    # Replace this source's prior revision; keep unrelated episodes and sources.
    index["tracks"] = [t for t in index["tracks"] if not (
        set(t["videoIds"]) & set(video_ids) and t["type"] == media_type
        and t["lang"] == language and t["source"] == new_tracks[0]["source"]
        and (not romaji_only or t["script"] == Script.ROMAJI.value)
    )] + new_tracks
    index["tracks"].sort(key=lambda track: track["id"])
    index["revision"] = hashlib.sha256(json.dumps(
        {k: index[k] for k in ("tracks", "vocabulary", "registry")},
        sort_keys=True, ensure_ascii=False,
    ).encode()).hexdigest()
    commit_index(index_path, index, original)
    result = {"tracks": len(new_tracks), "cues": len(rows), "revision": index["revision"]}
    if source_archive is not None:
        result["source_archive"] = source_archive
    return result
