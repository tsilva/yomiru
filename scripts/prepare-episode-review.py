"""Prepare the private cue review packet or validate its completed review."""

import argparse
import gzip
import json
import sys
from pathlib import Path

from yomiru.practice_matching import draft_matches, remember
from yomiru.reviewed_practice import coverage_counts, prepare, supplemental_words
from yomiru.subtitle_corpus import digest, encoded

PACKET_VERSION = 1


def review_rows(source, translation, vocabulary, practice, edits):
    english = {row["id"]: row["text"] for row in translation["cues"]}
    rows = {row[0]: row for row in practice["cues"]} if practice else {}
    words = {row["id"]: row for row in vocabulary["words"]}
    supplemental_words(words, edits)
    for cue in source["cues"]:
        cue_id = cue["id"]
        written = cue["japanese"]
        row = {
            "cue": cue_id,
            "time": [cue["start"], cue["end"]],
            "japanese": written,
            "annotations": cue["reading_source"],
            "translation": english[cue_id],
        }
        if cue_id in rows:
            _, kana, romaji, peeks, _, targets = rows[cue_id]
            questions = []
            for word_id, hs, he, rs, re, choices, (start, end) in targets:
                word = words[word_id]
                questions.append(
                    {
                        "span": [start, end],
                        "highlight": [written[start:end], kana[hs:he], romaji[rs:re]],
                        "choices": choices,
                        "wordId": word_id,
                        "entry": [
                            word["word"],
                            word["reading"],
                            word["pos"],
                            word["meanings"]["eng"],
                        ],
                    }
                )
            row.update(
                {
                    "kana": kana,
                    "romaji": romaji,
                    "questions": questions,
                    "peeks": peeks,
                    "coverage": practice["coverage"][cue_id]["spans"],
                }
            )
        yield row


def focused_rows(rows, baseline):
    old = {row["cue"]: row for row in baseline}
    current = {row["cue"]: row for row in rows}
    changes = {cue for cue in old.keys() | current.keys() if current.get(cue) != old.get(cue)}
    affected = [
        row for cue in changes for row in (current.get(cue), old.get(cue)) if row is not None
    ]
    repeated = {row["japanese"] for row in affected}
    ids = {question["wordId"] for row in affected for question in row.get("questions", [])}
    forms = {question["highlight"][0] for row in affected for question in row.get("questions", [])}
    selected = {}
    for index, row in enumerate(rows):
        if row["cue"] in changes:
            selected[index] = "changed"
        elif row["japanese"] in repeated or any(
            q["wordId"] in ids or q["highlight"][0] in forms for q in row.get("questions", [])
        ):
            selected[index] = "repeat"
        elif any(
            row["japanese"][start:end] in forms or word in ids
            for start, end, word, *_ in row.get("coverage", [])
        ):
            selected[index] = "related span"
    for index in tuple(selected):
        for neighbor in (index - 1, index + 1):
            if 0 <= neighbor < len(rows):
                selected.setdefault(neighbor, "neighbor")
    return (
        [{**rows[index], "focus": reason} for index, reason in sorted(selected.items())],
        [cue for cue in old if cue not in current],
    )


def write_packet(output, metadata, rows, baseline=None):
    rows = list(rows)
    header = {"packetVersion": PACKET_VERSION, **metadata, "complete": baseline is None}
    if baseline is not None:
        with baseline.open(encoding="utf-8") as stream:
            prior = json.loads(next(stream, "{}"))
            if (
                prior.get("packetVersion") != PACKET_VERSION
                or prior.get("videoId") != header["videoId"]
                or prior.get("complete") is not True
            ):
                raise ValueError("Use a complete review packet for the same episode and rubric")
            rows, removed = focused_rows(rows, [json.loads(line) for line in stream])
        header["removedCues"] = removed
    with output.open("xb") as stream:
        for row in (header, *rows):
            stream.write(encoded(row) + b"\n")


def episode(corpus):
    [title] = corpus["titles"]
    [source] = corpus["sources"]
    [translation] = corpus["translations"]
    if (
        title["sourceRevision"] != source["id"]
        or translation["sourceRevision"] != source["id"]
        or translation["language"] not in {"eng", "por"}
        or translation["provenance"] != "paired"
    ):
        raise ValueError("Review requires one episode and its paired translation")
    return title, source, translation


def identity(title, source, translation, vocabulary, revision):
    return {
        "version": 1,
        "videoId": title["videoId"],
        "sourceRevision": source["id"],
        "translationId": translation["id"],
        "vocabularyRevision": revision,
        "vocabularyDigest": digest(encoded(vocabulary)),
    }


def draft(corpus, vocabulary, revision, output, matches_directory=None):
    title, source, translation = episode(corpus)
    english = translation["language"] == "eng"
    status = "pending" if english else "not-applicable"
    review = {
        **identity(title, source, translation, vocabulary, revision),
        "cues": {
            cue["id"]: {"translation": "pending", "practice": status} for cue in source["cues"]
        },
    }
    files = {
        "source": source,
        "translation": translation,
        "vocabulary": vocabulary,
        "review": review,
    }
    if english:
        review["practice"] = {
            "sourceRevision": source["id"],
            "translationId": translation["id"],
            "targets": [],
        }
        files["practice-matches"] = draft_matches(
            source,
            translation,
            vocabulary,
            review["practice"],
            matches_directory,
        )
        files["practice-preview"] = prepare(source, translation, vocabulary, review["practice"])
    output.mkdir(mode=0o700)
    for name, data in files.items():
        with (output / f"{name}.json").open("x", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
            file.write("\n")
    write_packet(
        output / "review-packet.jsonl",
        identity(title, source, translation, vocabulary, revision),
        review_rows(source, translation, vocabulary, files.get("practice-preview"), {}),
    )


def finish(corpus, vocabulary, revision, review):
    title, source, translation = episode(corpus)
    expected = identity(title, source, translation, vocabulary, revision)
    if any(review.get(key) != value for key, value in expected.items()):
        raise ValueError("Review source, translation, episode or vocabulary revision changed")
    english = translation["language"] == "eng"
    decisions = review["cues"]
    if set(decisions) != {cue["id"] for cue in source["cues"]}:
        raise ValueError("Review must record a decision for every source cue")
    for cue, outcome in decisions.items():
        translation_result = outcome.get("translation")
        if (
            translation_result not in {"accepted", "caption-ambiguity"}
            or translation_result == "caption-ambiguity"
            and not outcome.get("note", "").strip()
            or outcome.get("practice") != ("accepted" if english else "not-applicable")
        ):
            raise ValueError(f"Review is unresolved for {cue}")
    practice = None
    if english:
        practice_review = review["practice"]
        practice = prepare(source, translation, vocabulary, practice_review, check_aliases=True)
        if not coverage_counts(practice, require_complete=True)["ready"]:
            raise ValueError("Reviewed English episode has no contextual questions")
        subtitle_cues = practice_review.get("subtitleReadingCues", [])
        readings = practice_review.get("readings", {})
        if not isinstance(subtitle_cues, list) or any(
            not isinstance(cue, str) or not readings.get(cue) for cue in subtitle_cues
        ):
            raise ValueError("Subtitle reading cues must have reviewed Practice readings")
        if len(set(subtitle_cues)) != len(subtitle_cues):
            raise ValueError("Duplicate subtitle reading cue")
        if subtitle_cues:
            practice["subtitleReadings"] = {cue: readings[cue] for cue in subtitle_cues}
    elif "practice" in review:
        raise ValueError("English Practice review must be paired with the English translation")
    return {**expected, "reviewId": digest(encoded(review)), "practice": practice}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("vocabulary", type=Path)
    parser.add_argument("revision")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--draft", type=Path)
    mode.add_argument("--review", type=Path)
    mode.add_argument("--preview-review", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--matches-dir", type=Path)
    parser.add_argument("--baseline-packet", type=Path)
    args = parser.parse_args()
    with gzip.open(args.corpus, "rt", encoding="utf-8") as file:
        corpus = json.load(file)
    vocabulary = json.loads(args.vocabulary.read_bytes())
    if args.draft:
        draft(corpus, vocabulary, args.revision, args.draft, args.matches_dir)
        return
    if args.out is None:
        parser.error("--review requires --out")
    if args.preview_review:
        title, source, translation = episode(corpus)
        metadata = identity(title, source, translation, vocabulary, args.revision)
        review = json.loads(args.preview_review.read_bytes())
        if any(review.get(key) != value for key, value in metadata.items()):
            raise ValueError("Review source, translation, episode or vocabulary revision changed")
        edits = review.get("practice", {})
        practice = (
            prepare(source, translation, vocabulary, edits)
            if translation["language"] == "eng"
            else None
        )
        write_packet(
            args.out,
            metadata,
            review_rows(source, translation, vocabulary, practice, edits),
            args.baseline_packet,
        )
        return
    review = json.loads(args.review.read_bytes())
    corpus["releaseReview"] = finish(corpus, vocabulary, args.revision, review)
    if args.matches_dir is not None:
        _, source, translation = episode(corpus)
        remember(args.matches_dir, source, translation, vocabulary, review, corpus["releaseReview"])
    with args.out.open("xb") as file:
        file.write(encoded(corpus))


if __name__ == "__main__":
    try:
        main()
    except ValueError as error:
        sys.exit(f"Review rejected: {error}")
    except (AttributeError, KeyError, TypeError):
        sys.exit("Review rejected: Malformed review data")
