"""Compile reviewed question spans and choices into a private Practice asset."""

import argparse
import gzip
import json
from pathlib import Path

from yomiru.reviewed_practice import coverage_counts, prepare
from yomiru.subtitle_corpus import digest, encoded


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "translation", "vocabulary", "review", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--require-complete", action="store_true")
    args = parser.parse_args()
    payload = prepare(*(json.loads(path.read_bytes()) for path in (
        args.source, args.translation, args.vocabulary, args.review,
    )))
    counts = coverage_counts(payload, require_complete=args.require_complete)
    packed = gzip.compress(encoded(payload), mtime=0)
    if len(packed) > 3 * 1024 * 1024:
        raise ValueError("Practice analysis exceeds the private upload limit")
    sha256 = digest(packed)
    with (args.output / f"{sha256}.json.gz").open("xb") as file:
        file.write(packed)
    print(json.dumps({
        "sha256": sha256, "bytes": len(packed), "cues": len(payload["cues"]),
        "questions": sum(len(row[5]) for row in payload["cues"]), "coverage": counts,
    }))


if __name__ == "__main__":
    main()
