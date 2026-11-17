"""Find caption pairs on demand; generate ASS only when the viewer selects a track."""

import hashlib
import io
import json
import re
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import PurePosixPath

from yomiru.captions import Cue, parse_ass, parse_srt
from yomiru.coverage import QUALITY_VERSION, sparse_base
from yomiru.japanese import Script
from yomiru.library import Library, Track
from yomiru.network import HttpClient, ProviderError
from yomiru.providers import (
    Candidate,
    Kitsunekko,
    OpenSubtitles,
    archive_members,
    release_score,
    resolve_episode,
    with_aliases,
)
from yomiru.render import Appearance
from yomiru.timing import ALGORITHM, Timing


def captions(client: HttpClient, candidate: Candidate) -> list[Cue]:
    body = client.get(candidate.url, ttl=86400)
    return _parse_candidate(body, candidate)


def cached_captions(client: HttpClient, candidate: Candidate) -> list[Cue] | None:
    peek = getattr(client, "peek", None)
    if peek is None:
        return None
    body = peek(candidate.url)
    return _parse_candidate(body, candidate) if body is not None else None


def _parse_candidate(body: bytes, candidate: Candidate) -> list[Cue]:
    name = candidate.member or candidate.filename
    if candidate.member:
        if candidate.member not in archive_members(body):
            raise ProviderError("Selected episode is unavailable in the subtitle archive")
        try:
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                body = archive.read(candidate.member)
        except (zipfile.BadZipFile, KeyError, RuntimeError, OSError):
            raise ProviderError("Subtitle archive member could not be read") from None
    if len(body) > 4 * 1024 * 1024:
        raise ProviderError("Subtitle text exceeds the size limit")
    text = None
    encodings = ("utf-8-sig", "cp932") if candidate.language == "jpn" else ("utf-8-sig", "cp1252")
    for encoding in encodings:
        try:
            text = body.decode(encoding)
            break
        except UnicodeError:
            continue
    if text is None:
        raise ProviderError("Subtitle text encoding is unsupported")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if "<html" in text[:500].lower() or "<!doctype html" in text[:500].lower():
        raise ProviderError("Provider returned a web page instead of subtitles")
    if PurePosixPath(name).suffix.lower() in {".ass", ".ssa"} or "[Events]" in text[:10000]:
        cues = parse_ass(text)
    else:
        cues = parse_srt(text)
    if not cues or len(cues) > 15000:
        raise ProviderError("Provider returned no usable subtitle cues")
    if candidate.language == "jpn" and not any(re.search(r"[ぁ-ヿ一-龯]", c.text) for c in cues):
        raise ProviderError("Japanese subtitle candidate contains no Japanese text")
    return cues


@dataclass(frozen=True)
class Selection:
    key: str
    video_id: str
    media_type: str
    script: str
    japanese: Candidate
    base: Candidate
    appearance: Appearance
    filename: str
    timing: Timing


class Discovery:
    def __init__(
        self,
        library: Library,
        scripts: tuple[Script, ...] = (Script.ROMAJI,),
        appearance: Appearance | None = None,
        client: HttpClient | None = None,
        base_language: str = "eng",
        timing: Timing | None = None,
    ):
        self.library, self.scripts = library, scripts
        self.appearance = appearance or Appearance()
        self.timing = timing if timing is not None else Timing(align=True)
        if not re.fullmatch(r"[a-z]{3}", base_language):
            raise ValueError("Use a three-letter base subtitle language code")
        self.base_language = base_language
        self.directory = library.directory.parent / "discovery"
        self.client = client or HttpClient(self.directory)
        self.selections: dict[str, Selection] = {}
        self.generated: dict[str, Track] = {}
        self.results: dict[str, tuple[float, list[Selection], dict]] = {}
        self.lock = threading.RLock()

    def japanese_sources(self, video_id: str, media_type: str, extra: dict[str, str]):
        episode = resolve_episode(self.client, video_id, media_type)
        filename = extra.get("filename", "")
        if not isinstance(filename, str):
            raise ValueError("Video filename must be text")
        kit = Kitsunekko(self.client)
        rows = kit.search(episode, "jpn", filename[:1000])
        if rows:
            return rows
        try:
            expanded = with_aliases(self.client, episode)
        except ProviderError:
            return []
        return kit.search(expanded, "jpn", filename[:1000]) if expanded != episode else []

    def search(self, video_id: str, media_type: str, extra: dict[str, str]):
        extra = {
            k: v[:1000]
            for k, v in extra.items()
            if k in {"filename", "videoHash", "videoSize"} and isinstance(v, str)
        }
        identity = json.dumps([video_id, media_type, extra], sort_keys=True)
        with self.lock:
            cached = self.results.get(identity)
            if cached and cached[0] > time.time():
                return cached[1], cached[2]
            warnings = []
            try:
                episode = resolve_episode(self.client, video_id, media_type)
                kit = Kitsunekko(self.client)
                filename = extra.get("filename", "")

                def japanese_search():
                    return self.japanese_sources(video_id, media_type, extra)

                with ThreadPoolExecutor(max_workers=2) as pool:
                    japanese_future = pool.submit(japanese_search)
                    english_future = pool.submit(
                        OpenSubtitles(self.client).search, episode, extra, self.base_language
                    )
                    try:
                        japanese = japanese_future.result()
                    except (ValueError, OSError, TypeError, KeyError) as error:
                        japanese = []
                        warnings.append(
                            str(error)
                            if isinstance(error, ProviderError)
                            else "Japanese provider could not be queried"
                        )
                    try:
                        english = english_future.result()
                    except (ValueError, OSError, TypeError, KeyError):
                        english = []
                        warnings.append("English provider could not be queried")
                if japanese and not english and self.base_language == "eng":
                    try:
                        english = kit.search(episode, "eng", filename)
                    except (ValueError, OSError, TypeError, KeyError):
                        warnings.append("English fallback provider could not be queried")
                if japanese and english:
                    # Classify already downloaded responses without turning listing into
                    # a download of every source. Unseen pairs are checked on selection.
                    try:
                        reference = cached_captions(self.client, japanese[0])
                    except (ValueError, OSError):
                        reference = None
                    if reference:
                        usable = []
                        for base in english:
                            try:
                                existing = cached_captions(self.client, base)
                            except (ValueError, OSError):
                                existing = None
                            if existing is None or not sparse_base(reference, existing):
                                usable.append(base)
                        if len(usable) != len(english):
                            warnings.append("Skipped sparse base captions without enough dialogue")
                        english = usable
                if not japanese or not english:
                    missing = (
                        "Japanese"
                        if not japanese
                        else ("English" if self.base_language == "eng" else self.base_language)
                    )
                    status = {
                        "status": "unavailable",
                        "message": f"No {missing} captions found",
                        "warnings": warnings,
                    }
                    selections = []
                else:
                    # Prefer the Japanese candidate closest to the selected release. Keep
                    # one alternative, since filename evidence cannot establish audio sync.
                    selections = []
                    for base in english[:32]:
                        for ja in sorted(
                            japanese, key=lambda c: -release_score(c.filename, filename)
                        )[:2]:
                            for script in self.scripts:
                                values = [
                                    video_id,
                                    media_type,
                                    script.value,
                                    asdict(ja),
                                    asdict(base),
                                    asdict(self.appearance),
                                    extra,
                                    asdict(self.timing),
                                    ALGORITHM,
                                    QUALITY_VERSION,
                                ]
                                key = hashlib.sha256(
                                    json.dumps(values, sort_keys=True).encode()
                                ).hexdigest()
                                selection = Selection(
                                    key,
                                    video_id,
                                    media_type,
                                    script.value,
                                    ja,
                                    base,
                                    self.appearance,
                                    filename,
                                    self.timing,
                                )
                                self.selections[key] = selection
                                selections.append(selection)
                    status = {
                        "status": "available",
                        "message": "Caption pairs found; timing unverified",
                        "warnings": warnings,
                    }
            except (ValueError, OSError, TypeError, KeyError) as error:
                selections = []
                message = str(error) if isinstance(error, ProviderError) else "Discovery failed"
                status = {"status": "unavailable", "message": message, "warnings": warnings}
            if len(self.results) >= 100:
                oldest = next(iter(self.results))
                _, previous, _ = self.results.pop(oldest)
                for item in previous:
                    self.selections.pop(item.key, None)
                    self.generated.pop(item.key, None)
            self.results[identity] = (
                time.time() + (1800 if selections else 60),
                selections,
                status,
            )
            return selections, status

    def generate(self, key: str) -> bytes | None:
        with self.lock:
            if key in self.generated:
                return self.library.subtitle(self.generated[key].key)
            selection = self.selections.get(key)
            if selection is None:
                return self.library.discovered(key)
            for track in self.library.tracks(selection.video_id, selection.media_type):
                if track.discovery_key == key:
                    self.generated[key] = track
                    return self.library.subtitle(track.key)
            japanese = captions(self.client, selection.japanese)
            try:
                english = captions(self.client, selection.base)
            except (ValueError, OSError):
                raise ProviderError(
                    "The selected subtitle source is unavailable; choose another Yomiru entry"
                ) from None
            if sparse_base(japanese, english):
                for identity, (_, rows, status) in self.results.items():
                    if any(row.base == selection.base for row in rows):
                        self.results[identity] = (0, rows, status)
                raise ProviderError(
                    "Selected base track has too little dialogue; choose a full-dialogue source"
                )
            provenance = {
                "japanese": {
                    "provider": selection.japanese.provider,
                    "filename": selection.japanese.filename,
                },
                "base": {
                    "provider": selection.base.provider,
                    "filename": selection.base.filename,
                    "language": selection.base.language,
                },
                "timing": "unverified; original cue times preserved",
            }
            track = self.library.build_cues(
                japanese,
                english,
                selection.video_id,
                Script(selection.script),
                selection.appearance,
                selection.media_type,
                provenance=provenance,
                discovery_key=selection.key,
                base_label="Selected subtitle",
                timing=selection.timing,
            )
            self.generated[key] = track
            return self.library.subtitle(track.key)
