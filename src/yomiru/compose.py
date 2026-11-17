"""Compose selected caption documents without fetching client-supplied URLs."""

import hashlib
import json
import re

from yomiru.captions import parse_document
from yomiru.discovery import Discovery, captions
from yomiru.japanese import Script
from yomiru.library import Library, Track
from yomiru.render import Appearance
from yomiru.timing import Timing


def compose(library: Library, payload: dict, discovery: Discovery | None = None) -> Track:
    if not isinstance(payload, dict):
        raise ValueError("A caption pair is required")
    video_id = payload.get("video_id", "")
    media_type = payload.get("type", "series")
    if not isinstance(video_id, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,200}", video_id):
        raise ValueError("Choose a valid episode identity")
    if media_type not in {"movie", "series"}:
        raise ValueError("Choose a movie or series")
    script = Script(payload.get("script", "romaji"))
    base = payload.get("base")
    if not isinstance(base, dict):
        raise ValueError("Choose the subtitle track to keep below the Japanese reading")
    lower = parse_document(base.get("text"), base.get("format"))
    japanese = payload.get("japanese")
    source = "Selected Japanese track"
    if japanese is not None:
        if not isinstance(japanese, dict):
            raise ValueError("Japanese captions must be a subtitle document")
        upper = parse_document(japanese.get("text"), japanese.get("format"))
    elif discovery:
        extra = payload.get("extra", {})
        if not isinstance(extra, dict):
            raise ValueError("Episode details must be an object")
        candidates = discovery.japanese_sources(video_id, media_type, extra)
        if not candidates:
            raise ValueError("No Japanese captions found; choose a Japanese subtitle file")
        upper = captions(discovery.client, candidates[0])
        source = candidates[0].provider + ": " + candidates[0].filename
    else:
        raise ValueError("Choose a Japanese track or enable Japanese discovery")
    if not any(re.search(r"[ぁ-ヿ一-龯]", cue.text) for cue in upper):
        raise ValueError("The Japanese track contains no Japanese text")
    options = payload.get("appearance", {})
    if not isinstance(options, dict) or set(options) - {
        "width",
        "height",
        "japanese_colour",
        "english_colour",
    }:
        raise ValueError("Unsupported subtitle appearance options")
    appearance = Appearance(**options)
    timing_options = payload.get("timing", {})
    if not isinstance(timing_options, dict) or set(timing_options) - {
        "align", "japanese_delay_ms", "base_delay_ms",
    }:
        raise ValueError("Unsupported subtitle timing options")
    timing = Timing(**timing_options)
    # Store caption-derived identity, never a source URL or browser session data.
    identity = hashlib.sha256(
        json.dumps(
            [
                video_id,
                script.value,
                [(c.start, c.end, c.text) for c in upper],
                [(c.start, c.end, c.text) for c in lower],
                options,
                timing_options,
            ],
            ensure_ascii=False,
            sort_keys=True,
        ).encode()
    ).hexdigest()
    return library.build_cues(
        upper,
        lower,
        video_id,
        script,
        appearance,
        media_type,
        provenance={
            "japanese": source,
            "base": "Selected subtitle track",
            "timing": "unverified; selected cue times preserved",
        },
        discovery_key=identity,
        base_label="Selected subtitle",
        timing=timing,
    )
