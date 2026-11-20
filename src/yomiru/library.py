"""A local, content-addressed library of generated tracks."""

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile

from yomiru.captions import Cue, load_captions
from yomiru.japanese import Script
from yomiru.render import Appearance, render_ass
from yomiru.timing import Timing, adjust

ACTIVE_SCRIPTS = frozenset(Script)
STORED_SCRIPTS = ACTIVE_SCRIPTS | {"hiragana", "katakana"}


@dataclass(frozen=True)
class Track:
    key: str
    video_id: str
    media_type: str
    script: str
    release_hint: str
    discovery_key: str = ""


class Library:
    def __init__(self, directory: Path):
        self.directory = directory.resolve()
        self.directory.mkdir(parents=True, exist_ok=True)

    def build(
        self,
        japanese: Path,
        english: Path,
        video_id: str,
        script: Script,
        appearance: Appearance,
        media_type: str = "series",
        release_hint: str = "",
        *,
        timing: Timing | None = None,
    ) -> Track:
        return self.build_cues(
            load_captions(japanese),
            load_captions(english),
            video_id,
            script,
            appearance,
            media_type,
            release_hint,
            timing=timing,
        )

    def build_cues(
        self,
        japanese: list[Cue],
        english: list[Cue],
        video_id: str,
        script: Script,
        appearance: Appearance,
        media_type: str = "series",
        release_hint: str = "",
        *,
        provenance: dict | None = None,
        discovery_key: str = "",
        base_label: str = "English",
        timing: Timing | None = None,
    ) -> Track:
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,200}", video_id):
            raise ValueError("Video ID must be an identifier, not a URL or path")
        if media_type not in {"movie", "series"}:
            raise ValueError("Media type must be movie or series")
        japanese, english, timing_report = adjust(japanese, english, timing or Timing())
        provenance = {**(provenance or {}), "timing": timing_report}
        rendered = render_ass(japanese, english, script, appearance, base_label=base_label)
        rendered = rendered.replace(
            "ScriptType: v4.00+",
            "; Yomiru-Timing: " + json.dumps(timing_report) + "\nScriptType: v4.00+",
            1,
        )
        identity = json.dumps(
            [
                video_id,
                media_type,
                script.value,
                release_hint,
                asdict(appearance),
                rendered,
                provenance,
                discovery_key,
            ],
            ensure_ascii=False,
        )
        key = hashlib.sha256(identity.encode()).hexdigest()
        track = Track(key, video_id, media_type, script.value, release_hint, discovery_key)
        self._write(self.directory / f"{key}.ass", rendered)
        self._write(self.directory / f"{key}.json", json.dumps(asdict(track), ensure_ascii=False))
        if provenance:
            self._write(
                self.directory / f"{key}.provenance.json",
                json.dumps(provenance, ensure_ascii=False),
            )
        return track

    def _write(self, target: Path, content: str) -> None:
        temporary = None
        try:
            with NamedTemporaryFile("w", dir=self.directory, encoding="utf-8", delete=False) as f:
                temporary = Path(f.name)
                f.write(content)
            temporary.replace(target)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def _records(self) -> list[Track]:
        result = []
        for path in sorted(self.directory.glob("*.json")):
            try:
                track = Track(**json.loads(path.read_text(encoding="utf-8")))
            except (OSError, ValueError, TypeError):
                continue
            if not all(isinstance(value, str) for value in asdict(track).values()):
                continue
            if (
                not re.fullmatch(r"[a-f0-9]{64}", track.key)
                or path.stem != track.key
                or track.script not in STORED_SCRIPTS
                or not (self.directory / f"{track.key}.ass").is_file()
            ):
                continue
            result.append(track)
        return result

    def tracks(self, video_id: str, media_type: str, filename: str = "") -> list[Track]:
        return [
            track
            for track in self._records()
            if track.video_id == video_id
            and track.media_type == media_type
            and track.script in ACTIVE_SCRIPTS
            and (not track.release_hint or track.release_hint.casefold() in filename.casefold())
        ]

    def discovered(self, key: str) -> bytes | None:
        for track in self._records():
            if track.discovery_key == key:
                return self.subtitle(track.key)
        return None

    def subtitle(self, key: str) -> bytes | None:
        if not re.fullmatch(r"[a-f0-9]{64}", key):
            return None
        path = self.directory / f"{key}.ass"
        if path.is_symlink() or not path.is_file():
            return None
        return path.read_bytes()
