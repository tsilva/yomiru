"""Pack verified public tracks and private subtitle inputs for PostgreSQL."""

import argparse
import gzip
import json
from pathlib import Path

from yomiru.subtitle_corpus import encoded, prepare_corpus


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("index", "archive-index", "pair-index", "assets", "vocabularies", "out"):
        parser.add_argument(f"--{key}", type=Path, required=True)
    parser.add_argument("--practice-reviews", type=Path)
    args = parser.parse_args()

    def read(path):
        return json.loads(path.read_bytes())

    pack = prepare_corpus(
        read(args.index), read(args.archive_index), read(args.pair_index), args.assets,
        args.vocabularies,
        practice_reviews=read(args.practice_reviews) if args.practice_reviews else None,
    )
    with args.out.open("xb") as output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0) as compressed:
            compressed.write(encoded(pack))
    print(json.dumps({key: len(pack[key]) for key in ("titles", "choices", "tracks", "contexts")}))


if __name__ == "__main__":
    main()
