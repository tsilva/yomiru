"""Conservative caption-to-caption offset fitting; this does not inspect audio."""

from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from statistics import median

from yomiru.captions import Cue

ALGORITHM = "onset-boundaries-v2"
BOUNDARY_WINDOW_MS = 250


@dataclass(frozen=True)
class Timing:
    align: bool = False
    japanese_delay_ms: int = 0
    base_delay_ms: int = 0

    def __post_init__(self):
        if not isinstance(self.align, bool):
            raise ValueError("Timing alignment must be true or false")
        for delay in (self.japanese_delay_ms, self.base_delay_ms):
            if type(delay) is not int or not -60000 <= delay <= 60000:
                raise ValueError("Caption delays must be integer milliseconds within one minute")


def _matches(japanese: list[int], base: list[int], offset: int):
    # A base onset can support only one Japanese onset, even in dense captions.
    chosen = {}
    for start in japanese:
        target = start + offset
        index = bisect_left(base, target)
        nearby = range(max(0, index - 1), min(len(base), index + 1))
        index = min(nearby, key=lambda i: abs(base[i] - target))
        error = abs(base[index] - target)
        if error <= 150 and (index not in chosen or error < chosen[index][0]):
            chosen[index] = (error, start, base[index] - start)
    return list(chosen.values())


def estimate_offset(japanese: list[Cue], base: list[Cue]) -> dict:
    ja = sorted({c.start for c in japanese if c.text.strip()})
    en = sorted({c.start for c in base if c.text.strip()})
    report = {
        "algorithm": ALGORITHM, "automatic_offset_ms": 0,
        "status": "uncertain", "audio_verified": False,
    }
    if len(ja) < 24 or len(en) < 24 or ja[-1] - ja[0] < 120000:
        return {**report, "reason": "Not enough caption timing evidence"}
    # Bound fitting work even for unusually large caption documents.
    if len(ja) > 600:
        ja = [ja[i * (len(ja) - 1) // 599] for i in range(600)]
    trials = [(len(_matches(ja, en, offset)), offset) for offset in range(-2000, 2001, 20)]
    best, candidate = max(trials, key=lambda trial: (trial[0], -abs(trial[1])))
    baseline = len(_matches(ja, en, 0))
    reference_count = min(len(ja), len(en))
    matched = _matches(ja, en, candidate)
    report.update(
        matches=best, baseline_matches=baseline,
        sampled_cues=len(ja), base_onsets=len(en), candidate_offset_ms=candidate,
    )
    if best < max(24, reference_count * 0.5):
        return {**report, "reason": "Too few corresponding caption starts"}
    competing = max(count for count, offset in trials if abs(offset - candidate) > 300)
    if best - competing < reference_count * 0.10:
        return {**report, "reason": "Several offsets fit similarly"}
    correction = round(median(item[2] for item in matched))
    if abs(correction) >= 1900:
        return {**report, "reason": "Offset is near the search limit"}
    # A cut or framerate change must not be mistaken for a constant offset.
    span = ja[-1] - ja[0]
    for section in range(3):
        offsets = [
            delta for _, start, delta in matched
            if min(2, (start - ja[0]) * 3 // (span + 1)) == section
        ]
        if len(offsets) < 6 or abs(median(offsets) - correction) > 120:
            return {**report, "reason": "Offset is not consistent across the caption timeline"}
    if best - baseline < reference_count * 0.10 or abs(candidate) < 80:
        return {
            **report, "status": "unchanged",
            "reason": "Source timing is close; only clear cue boundaries may be aligned",
        }
    return {
        **report,
        "automatic_offset_ms": correction,
        "status": "aligned",
        "reason": "Consistent caption starts; base timeline retained",
    }


def shift(cues: list[Cue], delay_ms: int) -> list[Cue]:
    return [
        Cue(max(0, c.start + delay_ms), c.end + delay_ms, c.text)
        for c in cues if c.end + delay_ms > 0
    ]


def align_boundaries(japanese: list[Cue], base: list[Cue]):
    """Snap only mutually unique, similarly timed complete cues; never split text."""
    ordered = sorted(base, key=lambda c: c.start)
    starts = [c.start for c in ordered]
    pairs = {}
    references = {}
    for index, cue in enumerate(japanese):
        if cue.end - cue.start < 400:
            continue
        left = bisect_left(starts, cue.start - BOUNDARY_WINDOW_MS)
        right = bisect_right(starts, cue.start + BOUNDARY_WINDOW_MS)
        # Dense overlapping effects are ambiguous; also bound work on hostile inputs.
        if right - left > 8:
            continue
        candidates = [
            i for i in range(left, right)
            if abs(ordered[i].end - cue.end) <= BOUNDARY_WINDOW_MS
            and ordered[i].end - ordered[i].start >= 400
        ]
        if len(candidates) == 1:
            target = candidates[0]
            pairs[index] = target
            references[target] = references.get(target, 0) + 1
    result, aligned, largest = [], 0, 0
    for index, cue in enumerate(japanese):
        target = pairs.get(index)
        if target is not None and references[target] == 1:
            reference = ordered[target]
            movement = max(abs(reference.start - cue.start), abs(reference.end - cue.end))
            if movement:
                cue = Cue(reference.start, reference.end, cue.text)
                aligned += 1
                largest = max(largest, movement)
        result.append(cue)
    return result, aligned, largest


def adjust(japanese: list[Cue], base: list[Cue], options: Timing):
    report = estimate_offset(japanese, base) if options.align else {
        "automatic_offset_ms": 0, "status": "disabled", "audio_verified": False,
        "reason": "Automatic fitting disabled",
    }
    automatic = shift(japanese, report["automatic_offset_ms"])
    aligned, largest = 0, 0
    if options.align and report["status"] in {"aligned", "unchanged"}:
        automatic, aligned, largest = align_boundaries(automatic, base)
    japanese_delay = report["automatic_offset_ms"] + options.japanese_delay_ms
    report.update(
        japanese_delay_ms=japanese_delay,
        manual_japanese_delay_ms=options.japanese_delay_ms,
        base_delay_ms=options.base_delay_ms,
        boundary_aligned_cues=aligned,
        largest_boundary_adjustment_ms=largest,
        boundary_window_ms=BOUNDARY_WINDOW_MS if options.align else 0,
    )
    return (
        shift(automatic, options.japanese_delay_ms),
        shift(base, options.base_delay_ms),
        report,
    )
