"""Parse subtitle text without retaining source ASS styling or commands."""

import html
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Cue:
    start: int  # milliseconds
    end: int
    text: str

    def __post_init__(self):
        if self.start < 0 or self.end <= self.start:
            raise ValueError("Cue times must be nonnegative and end after start")


def milliseconds(value: str) -> int:
    match = re.fullmatch(r"(\d+):(\d{2}):(\d{2})[.,](\d{1,3})", value.strip())
    if not match:
        raise ValueError(f"Invalid subtitle timestamp: {value}")
    hours, minutes, seconds, fraction = match.groups()
    if int(minutes) >= 60 or int(seconds) >= 60:
        raise ValueError(f"Invalid subtitle timestamp: {value}")
    return (
        int(hours) * 3_600_000
        + int(minutes) * 60_000
        + int(seconds) * 1000
        + int(fraction.ljust(3, "0"))
    )


def plain_text(text: str) -> str:
    text = re.sub(r"\{[^}]*\}", "", text)
    text = text.replace(r"\N", " ").replace(r"\n", " ").replace(r"\h", " ")
    text = html.unescape(re.sub(r"<[^>]*>", "", text))
    return re.sub(r"\s+", " ", text).strip()


def parse_srt(text: str) -> list[Cue]:
    cues = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = block.splitlines()
        index = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if index is None:
            if block.strip():
                raise ValueError("SRT block has no timestamp")
            continue
        start, end = lines[index].split("-->", 1)
        content = plain_text(" ".join(lines[index + 1 :]))
        cue = Cue(milliseconds(start), milliseconds(end), content)
        if content:
            cues.append(cue)
    return sorted(cues, key=lambda cue: (cue.start, cue.end))


def parse_ass(text: str) -> list[Cue]:
    fields: list[str] = []
    cues = []
    in_events = False
    for line in text.splitlines():
        if line.startswith("["):
            in_events = line.strip().lower() == "[events]"
        elif in_events and line.startswith("Format:"):
            fields = [item.strip().lower() for item in line.split(":", 1)[1].split(",")]
            if not fields or fields[-1] != "text" or not {"start", "end"}.issubset(fields):
                raise ValueError("ASS events require Start, End and a final Text field")
        elif in_events and line.startswith("Dialogue:"):
            if not fields:
                raise ValueError("ASS dialogue has no event Format")
            values = line.split(":", 1)[1].lstrip().split(",", len(fields) - 1)
            if len(values) != len(fields):
                raise ValueError("Incomplete ASS dialogue")
            row = dict(zip(fields, values, strict=True))
            cue = Cue(milliseconds(row["start"]), milliseconds(row["end"]), plain_text(row["text"]))
            if cue.text:
                cues.append(cue)
    return sorted(cues, key=lambda cue: (cue.start, cue.end))


def parse_vtt(text: str) -> list[Cue]:
    """Read timed WebVTT cues, ignoring headers, notes and cue positioning."""
    text = text.lstrip("\ufeff")
    if not re.match(r"WEBVTT(?:\s|$)", text):
        raise ValueError("WebVTT subtitles must start with WEBVTT")
    cues = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = block.splitlines()
        if lines[0].startswith(("WEBVTT", "NOTE", "STYLE", "REGION")):
            continue
        index = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if index is None:
            raise ValueError("WebVTT cue has no timestamp")
        start, end = lines[index].split("-->", 1)
        end = end.strip().split()[0]
        start = start.strip()
        if start.count(":") == 1:
            start = "00:" + start
        if end.count(":") == 1:
            end = "00:" + end
        content = plain_text(" ".join(lines[index + 1 :]))
        cue = Cue(milliseconds(start), milliseconds(end), content)
        if content:
            cues.append(cue)
    return sorted(cues, key=lambda cue: (cue.start, cue.end))


def parse_document(text: str, format: str) -> list[Cue]:
    if not isinstance(text, str) or len(text.encode("utf-8")) > 2 * 1024 * 1024:
        raise ValueError("Subtitle text must be at most 2 MiB")
    text = text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    parser = {"srt": parse_srt, "ass": parse_ass, "ssa": parse_ass, "vtt": parse_vtt}.get(format)
    if parser is None:
        raise ValueError("Supported subtitle formats are SRT, ASS/SSA and WebVTT")
    cues = parser(text)
    if not cues or len(cues) > 15000:
        raise ValueError("Subtitle document must contain between 1 and 15000 text cues")
    return cues


def load_captions(path: Path) -> list[Cue]:
    return parse_document(path.read_text(encoding="utf-8-sig"), path.suffix.lower().lstrip("."))


def coalesce(cues: list[Cue]) -> list[Cue]:
    """Combine simultaneous captions to prevent collisions within one language."""
    changes = sorted({point for cue in cues for point in (cue.start, cue.end)})
    result: list[Cue] = []
    for start, end in zip(changes, changes[1:], strict=False):
        active = dict.fromkeys(cue.text for cue in cues if cue.start < end and cue.end > start)
        if not active:
            continue
        text = " / ".join(active)
        if result and result[-1].end == start and result[-1].text == text:
            result[-1] = Cue(result[-1].start, end, text)
        else:
            result.append(Cue(start, end, text))
    return result
