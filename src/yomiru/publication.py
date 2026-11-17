"""Build an administrator-managed public library from validated translation pairs."""

import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from yomiru.captions import Cue
from yomiru.japanese import Script
from yomiru.render import Appearance, render_ass
from yomiru.translation import atomic_json, validate_response

FORMAT = 1
MAX_PAIRS_BYTES = 8 * 1024 * 1024
IDENTIFIER = re.compile(r"[A-Za-z0-9_.:-]{1,200}")


def publish(
    pairs_path: Path,
    directory: Path,
    video_ids: list[str],
    source_label: str,
    source_url: str,
    *,
    media_type: str = "series",
    language: str = "eng",
) -> dict:
    """Add one complete episode; raw inputs and inference traces remain private."""
    if not video_ids or any(not IDENTIFIER.fullmatch(v) for v in video_ids):
        raise ValueError("Supply exact episode IDs, not URLs or paths")
    if media_type not in {"series", "movie"} or not re.fullmatch(r"[a-z]{3}", language):
        raise ValueError("Invalid media type or three-letter language")
    if not source_label.strip() or len(source_label) > 160 or any(
        ord(c) < 32 for c in source_label
    ):
        raise ValueError("Supply a short public source label")
    url = urlsplit(source_url)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query:
        raise ValueError("Source attribution must be a public HTTPS URL without credentials")
    if pairs_path.is_symlink() or pairs_path.stat().st_size > MAX_PAIRS_BYTES:
        raise ValueError("Translation pairs exceed the input limit or are a symlink")
    document = json.loads(pairs_path.read_text(encoding="utf-8"))
    rows = document["cues"]
    if not isinstance(rows, list) or not 1 <= len(rows) <= 15000:
        raise ValueError("A complete nonempty episode is required")
    ids = [row["id"] for row in rows]
    translations = validate_response(json.dumps({"translations": [
        {"id": row["id"], "text": row["translation"]} for row in rows
    ]}), ids)
    japanese, english = [], []
    for row in rows:
        start, end = row["start"], row["end"]
        if (
            type(start) is not int or type(end) is not int
            or not 0 <= start < end <= 24 * 60 * 60 * 1000
            or not isinstance(row["japanese"], str) or not row["japanese"].strip()
        ):
            raise ValueError("Invalid Japanese anchor or cue times")
        japanese.append(Cue(start, end, row.get("reading_source") or row["japanese"]))
        english.append(Cue(start, end, translations[row["id"]]))
    directory.mkdir(parents=True, exist_ok=True)
    index_path = directory / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {
        "version": FORMAT, "tracks": [],
    }
    if index.get("version") != FORMAT or not isinstance(index.get("tracks"), list):
        raise ValueError("Unsupported published library")
    metadata = document.get("metadata", {})
    validation = metadata.get("validation", {})
    if (
        metadata.get("errors") or metadata.get("failures")
        or validation.get("cues") != len(rows)
        or validation.get("timestamp_mismatches") != 0
    ):
        raise ValueError("Only complete structurally validated translation pairs can publish")
    # Use the complete generation identity privately; export only safe public fields.
    generation = hashlib.sha256(pairs_path.read_bytes()).hexdigest()
    new_tracks = []
    for script in Script:
        content = render_ass(
            japanese, english, script, Appearance(), base_label="AI translation",
        ).encode("utf-8")
        checksum = hashlib.sha256(content).hexdigest()
        filename = f"{checksum}.ass"
        target = directory / filename
        if target.is_symlink():
            raise ValueError("Published subtitle assets cannot be symlinks")
        if target.exists() and target.read_bytes() != content:
            raise ValueError("Immutable subtitle asset differs")
        target.write_bytes(content)
        identity = hashlib.sha256(json.dumps(
            [sorted(set(video_ids)), media_type, language, script.value, generation, checksum],
        ).encode()).hexdigest()
        new_tracks.append({
            "id": identity, "videoIds": sorted(set(video_ids)), "type": media_type,
            "lang": language, "script": script.value, "sha256": checksum,
            "path": f"/library/{filename}", "bytes": len(content), "cues": len(rows),
            "source": {"label": source_label, "url": source_url},
            "timing": "Japanese source times; video synchronization unverified",
            "translation": "AI generated; administrator published",
            "generation": generation,
        })
    # Replace this source's prior revision; keep unrelated episodes and sources.
    index["tracks"] = [t for t in index["tracks"] if not (
        set(t["videoIds"]) & set(video_ids) and t["type"] == media_type
        and t["lang"] == language and t["source"] == new_tracks[0]["source"]
    )] + new_tracks
    index["tracks"].sort(key=lambda track: track["id"])
    index["revision"] = hashlib.sha256(json.dumps(
        index["tracks"], sort_keys=True, ensure_ascii=False,
    ).encode()).hexdigest()
    atomic_json(index_path, index)
    return {"tracks": len(new_tracks), "cues": len(rows), "revision": index["revision"]}
