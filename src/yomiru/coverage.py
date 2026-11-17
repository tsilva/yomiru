"""Reject clearly sparse automatic base tracks without guessing their language."""

from yomiru.captions import Cue

QUALITY_VERSION = "dialogue-coverage-v1"


def _duration(cues: list[Cue]) -> int:
    total, previous_end = 0, 0
    for cue in sorted(cues, key=lambda c: c.start):
        total += max(0, cue.end - max(cue.start, previous_end))
        previous_end = max(previous_end, cue.end)
    return total


def sparse_base(japanese: list[Cue], base: list[Cue]) -> bool:
    """Only flag extreme count AND duration differences in substantial sources."""
    japanese_starts = len({c.start for c in japanese})
    japanese_duration = _duration(japanese)
    return (
        japanese_starts >= 24
        and japanese_duration >= 120000
        and len({c.start for c in base}) < japanese_starts * 0.15
        and _duration(base) < japanese_duration * 0.25
    )
