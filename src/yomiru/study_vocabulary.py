"""Decide which Japanese token uses belong in the study vocabulary."""

import json
import re
import unicodedata
from collections import Counter

NON_LEXICAL = re.compile(r"[+−-]?\d+(?:[.,]\d+)*|[A-Za-z]")
SPEAKER = re.compile(r"^\s*[（(]([^（）()\s]+)[）)]")
KATAKANA_NAME = re.compile(r"[ァ-ヺー]{2,}")
ADDRESS_SUFFIX = re.compile(r"(?:さん|君|くん|ちゃん|さま|様|殿)(?=$|[^ァ-ヺ])")
ADDRESS_END = re.compile(r"^[\sー〜～]*[、,。.!?！？…]|^[\sー〜～]*$")
VOCALIZATION = re.compile(r"[あぁえぇおぉ]{3,}|[うぅっー]{2,}|[ぐうぅ][あぁおぉっー〜～]+")
VOCALIZATION_END = re.compile(r"^[\sっー〜～]*[、,。.!?！？…]|^[\sっー〜～]*$")
CUE_ID = re.compile(r"c\d{5}")


def read_reviewed_spans(path):
    if path is None:
        return None
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError("Reviewed exclusions must be a regular JSON file below 2 MiB")
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("Reviewed exclusions must map cue IDs to token spans")
    result = {}
    for cue, spans in raw.items():
        if not CUE_ID.fullmatch(cue) or not isinstance(spans, list) or any(
            not isinstance(span, list) or len(span) != 2
            or any(type(offset) is not int for offset in span) or not 0 <= span[0] < span[1]
            for span in spans
        ):
            raise ValueError("Reviewed exclusions must identify exact cue token spans")
        result[cue] = [tuple(span) for span in spans]
    return result


def speaker_names(rows):
    """Use recurring labels as evidence for otherwise ambiguous direct address."""
    labels = Counter()
    for row in rows:
        for line in row.get("reading_source", row["japanese"]).splitlines():
            match = SPEAKER.match(unicodedata.normalize("NFKC", line))
            if match and KATAKANA_NAME.fullmatch(match[1]):
                labels[match[1]] += 1
    return {label for label, count in labels.items() if count >= 2}


def excluded_use(surface, feature, text, start, end, speakers):
    if feature.pos2 == "固有名詞" or NON_LEXICAL.fullmatch(surface):
        return True
    before, after = text[:start], text[end:]
    if surface in speakers:
        if ADDRESS_SUFFIX.match(after):
            return True
        if ADDRESS_END.match(after) and (not before or before.endswith((" ", "、", "。"))):
            return True
    if feature.pos1 in {"感動詞", "副詞"} and VOCALIZATION.fullmatch(surface):
        return VOCALIZATION_END.match(after) is not None
    return False
