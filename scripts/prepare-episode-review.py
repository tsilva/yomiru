"""Prepare the private cue review packet or validate its completed review."""

import argparse
import gzip
import json
import sys
from pathlib import Path

from yomiru.practice_matching import draft_matches, remember
from yomiru.reviewed_practice import coverage_counts, prepare
from yomiru.subtitle_corpus import digest, encoded


def episode(corpus):
    [title] = corpus["titles"]
    [source] = corpus["sources"]
    [translation] = corpus["translations"]
    if (title["sourceRevision"] != source["id"] or translation["sourceRevision"] != source["id"]
            or translation["language"] not in {"eng", "por"}
            or translation["provenance"] != "paired"):
        raise ValueError("Review requires one episode and its paired translation")
    return title, source, translation


def identity(title, source, translation, vocabulary, revision):
    return {
        "version": 1, "videoId": title["videoId"], "sourceRevision": source["id"],
        "translationId": translation["id"], "vocabularyRevision": revision,
        "vocabularyDigest": digest(encoded(vocabulary)),
    }


def draft(corpus, vocabulary, revision, output, matches_directory=None):
    title, source, translation = episode(corpus)
    english = translation["language"] == "eng"
    status = "pending" if english else "not-applicable"
    review = {
        **identity(title, source, translation, vocabulary, revision),
        "cues": {cue["id"]: {"translation": "pending", "practice": status}
                 for cue in source["cues"]},
    }
    files = {
        "source": source, "translation": translation, "vocabulary": vocabulary, "review": review,
    }
    if english:
        review["practice"] = {
            "sourceRevision": source["id"], "translationId": translation["id"], "targets": [],
        }
        files["practice-matches"] = draft_matches(
            source, translation, vocabulary, review["practice"], matches_directory,
        )
        files["practice-preview"] = prepare(source, translation, vocabulary, review["practice"])
    output.mkdir(mode=0o700)
    for name, data in files.items():
        with (output / f"{name}.json").open("x", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
            file.write("\n")


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
        if (translation_result not in {"accepted", "caption-ambiguity"}
                or translation_result == "caption-ambiguity" and not outcome.get("note", "").strip()
                or outcome.get("practice") != ("accepted" if english else "not-applicable")):
            raise ValueError(f"Review is unresolved for {cue}")
    practice = None
    if english:
        practice = prepare(source, translation, vocabulary, review["practice"], check_aliases=True)
        if not coverage_counts(practice, require_complete=True)["ready"]:
            raise ValueError("Reviewed English episode has no contextual questions")
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
    parser.add_argument("--out", type=Path)
    parser.add_argument("--matches-dir", type=Path)
    args = parser.parse_args()
    with gzip.open(args.corpus, "rt", encoding="utf-8") as file:
        corpus = json.load(file)
    vocabulary = json.loads(args.vocabulary.read_bytes())
    if args.draft:
        draft(corpus, vocabulary, args.revision, args.draft, args.matches_dir)
        return
    if args.out is None:
        parser.error("--review requires --out")
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
