"""Pack offline quiz analyses for the private source archive."""

import argparse
import gzip
import json
from collections import defaultdict
from pathlib import Path

from yomiru.subtitle_corpus import digest, encoded


def write_analysis(directory, data):
    payload = gzip.compress(encoded(data), mtime=0)
    if len(payload) > 3 * 1024 * 1024:
        raise ValueError("Practice analysis exceeds the private upload limit")
    sha256 = digest(payload)
    filename = f"{sha256}.json.gz"
    with (directory / filename).open("xb") as output:
        output.write(payload)
    return {"sha256": sha256, "bytes": len(payload)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    with gzip.open(args.corpus) as source:
        corpus = json.load(source)
    args.output.mkdir(mode=0o700)
    anchors = {row["sourceRevision"]: row["anchor"] for row in corpus["titles"]}
    sources, by_word = {}, defaultdict(list)
    for projection in sorted(corpus["contexts"], key=lambda row: row["sourceRevision"]):
        revision = projection["sourceRevision"]
        sources[revision] = write_analysis(args.output, {
            "version": 1, "kind": "practice-cues", "anchor": anchors[revision], **projection,
        })
        for word in sorted({row[1] for row in projection["examples"]}):
            by_word[word].append(len(sources) - 1)
    if sources.keys() != anchors.keys():
        raise ValueError("Practice analyses must cover the archived titles")
    index = write_analysis(args.output, {
        "version": 1, "kind": "practice-index", "sources": list(sources), "words": by_word,
    })
    (args.output / "manifest.json").write_bytes(encoded({
        "version": 1, "index": index, "sources": sources,
    }) + b"\n")


if __name__ == "__main__":
    main()
