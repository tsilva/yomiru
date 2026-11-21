"""Compile reviewed question spans and choices into a private Practice asset."""

import argparse
import gzip
import json
from collections import defaultdict
from pathlib import Path

from yomiru.japanese import JapaneseRenderer
from yomiru.practice_context import cue_readings, gloss_key
from yomiru.subtitle_corpus import digest, encoded
from yomiru.vocabulary import anchor_identity


def correct_readings(written, readings, corrections):
    kana, romaji, _, spans, names = readings
    for edit in sorted(corrections, key=lambda edit: edit["start"], reverse=True):
        start, end = edit["start"], edit["end"]
        if written[start:end] != edit["form"]:
            raise ValueError("Reading correction no longer matches the source span")
        first = next(p for (a, _), p in spans.items() if a == start)
        last = next(p for (_, b), p in spans.items() if b == end)
        hs, he, rs, re = first[0], last[1], first[2], last[3]
        if kana[hs:he] != edit["beforeKana"] or romaji[rs:re] != edit["beforeRomaji"]:
            raise ValueError("Reading correction no longer matches the generated reading")
        kana = kana[:hs] + edit["kana"] + kana[he:]
        romaji = romaji[:rs] + edit["romaji"] + romaji[re:]
        hd, rd = len(edit["kana"]) - (he - hs), len(edit["romaji"]) - (re - rs)
        spans = {key: (p if key[1] <= start else (p[0] + hd, p[1] + hd, p[2] + rd, p[3] + rd))
                 for key, p in spans.items() if key[1] <= start or key[0] >= end}
        spans[start, end] = (hs, he + hd, rs, re + rd)
    return kana, romaji, spans, names


def prepare(source, translation, vocabulary, review):
    if (source["anchor"] != vocabulary["anchor"]
            or anchor_identity(source["cues"]) != source["anchor"]
            or translation["sourceRevision"] != source["id"] or translation["language"] != "eng"
            or translation["provenance"] != "paired" or review["sourceRevision"] != source["id"]
            or review["translationId"] != translation["id"]):
        raise ValueError("The review, source, vocabulary and paired English revisions must agree")
    english = {row["id"]: row for row in translation["cues"]}
    if len(english) != len(source["cues"]) or len(english) != len(translation["cues"]):
        raise ValueError("Incomplete or duplicate paired translations")
    words = {row["id"]: row for row in vocabulary["words"]}
    reviewed = defaultdict(list)
    for target in review["targets"]:
        reviewed[target["cue"]].append(target)

    renderer = JapaneseRenderer()
    cues = []
    for cue in source["cues"]:
        cue_id = cue["id"]
        line = english[cue_id]
        if (line["start"], line["end"]) != (cue["start"], cue["end"]) or not line["text"].strip():
            raise ValueError(f"Invalid paired English for {cue_id}")
        if cue_id not in reviewed:
            continue
        written = cue["japanese"]
        corrections = review.get("readings", {}).get(cue_id, [])
        readings = cue_readings(renderer, written, cue["reading_source"])
        if readings is None and corrections:
            # Explicit reviewed readings can recover cues with source furigana.
            readings = cue_readings(renderer, written, written)
        if readings is None:
            raise ValueError(f"No aligned readings for reviewed cue {cue_id}")
        kana, romaji, spans, names = correct_readings(written, readings, corrections)
        tokens = {tuple(span): None if index is None else source["wordIds"][index]
                  for *span, index in cue["tokens"]}
        peeks = [[words_id, *position] for span, position in spans.items()
                 if (words_id := tokens.get(span) or names.get(span))]
        questions = []
        for target in sorted(reviewed.pop(cue_id), key=lambda target: target["start"]):
            start, end = target["start"], target["end"]
            word_id = target["wordId"]
            if written[start:end] != target["form"] or word_id not in words:
                raise ValueError(f"Invalid reviewed form or vocabulary ID for {cue_id}")
            if not any(start <= a < b <= end and word_id == key for (a, b), key in tokens.items()):
                raise ValueError(f"Target vocabulary is absent from the source span in {cue_id}")
            item = words[word_id]
            if item["pos"].split("/")[0] in {"助詞", "助動詞", "接頭辞", "接尾辞"}:
                raise ValueError(f"Standalone grammatical fragment in {cue_id}")
            if not item["meanings"].get("eng"):
                raise ValueError(f"Vocabulary entry has no English senses in {cue_id}")
            beginning = next((p for (a, _), p in spans.items() if a == start), None)
            ending = next((p for (_, b), p in spans.items() if b == end), None)
            if beginning is None or ending is None or (
                questions and beginning[0] < questions[-1][2]
            ):
                raise ValueError(f"Unaligned or overlapping reviewed span in {cue_id}")
            choices = target["choices"]
            if (not 2 <= len(choices) <= 4
                    or any(not isinstance(text, str) or not text.strip() or len(text) > 100
                           for text in choices)
                    or len({gloss_key(choice) for choice in choices}) != len(choices)):
                raise ValueError(f"Invalid choices for {cue_id}")
            questions.append([word_id, beginning[0], ending[1], beginning[2], ending[3], choices])
        cues.append([cue_id, kana, romaji, peeks, line["text"], questions])
    if reviewed or not cues:
        raise ValueError("Review contains unknown cues or no questions")
    return {"version": 1, "kind": "practice-cues", "anchor": source["anchor"],
            "sourceRevision": source["id"],
            "prepared": True, "translationId": translation["id"], "cues": cues, "examples": []}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "translation", "vocabulary", "review", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    payload = prepare(*(json.loads(path.read_bytes()) for path in (
        args.source, args.translation, args.vocabulary, args.review,
    )))
    packed = gzip.compress(encoded(payload), mtime=0)
    if len(packed) > 3 * 1024 * 1024:
        raise ValueError("Practice analysis exceeds the private upload limit")
    sha256 = digest(packed)
    with (args.output / f"{sha256}.json.gz").open("xb") as file:
        file.write(packed)
    print(json.dumps({"sha256": sha256, "bytes": len(packed), "cues": len(payload["cues"]),
                      "questions": sum(len(row[5]) for row in payload["cues"])}))


if __name__ == "__main__":
    main()
