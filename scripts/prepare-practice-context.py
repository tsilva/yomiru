"""Prepare private, cue-aligned subtitle bundles and quiz examples offline."""

import argparse
import gzip
import hashlib
import json
import re
from pathlib import Path

from yomiru.practice_context import practice_projection
from yomiru.vocabulary import anchor_identity


def read_translation(path, field, anchor):
    data = path.read_bytes()
    rows = json.loads(data)["cues"]
    if anchor_identity(rows) != anchor or len({row["id"] for row in rows}) != len(rows):
        raise ValueError("Translation pairs do not match the archived Japanese anchor")
    translated = {row["id"]: row[field] for row in rows}
    if any(not isinstance(text, str) or not text.strip() for text in translated.values()):
        raise ValueError("Every source cue requires a nonempty translation")
    return rows, translated, hashlib.sha256(data).hexdigest()


def prepare(
    manifest_path, english_path, english_field, portuguese_path, portuguese_field, vocabulary_path,
    *, excluded_cues=(), reviewed_examples=(),
):
    source = manifest_path.read_bytes()
    manifest = json.loads(source)
    descriptor = manifest["analysis"]
    if not re.fullmatch(r"analyses/[0-9a-f]{64}\.json\.gz", descriptor["path"]):
        raise ValueError("Invalid archive analysis path")
    encoded = (manifest_path.parent.parent / descriptor["path"]).read_bytes()
    if hashlib.sha256(encoded).hexdigest() != descriptor["sha256"]:
        raise ValueError("Archive analysis checksum mismatch")
    analysis = json.loads(gzip.decompress(encoded))
    vocabulary = json.loads(vocabulary_path.read_bytes())
    anchor = manifest["anchor"]
    if (anchor != analysis["anchor"] or anchor != vocabulary["anchor"]
            or analysis["offsets"] != "unicode-codepoints"):
        raise ValueError("Source, analysis and vocabulary anchors must match")
    rows, english, english_revision = read_translation(english_path, english_field, anchor)
    _, portuguese, portuguese_revision = read_translation(portuguese_path, portuguese_field, anchor)
    source_rows = {row["id"]: row for row in rows}
    projection = practice_projection(
        analysis, source_rows, english, vocabulary,
        excluded_cues=excluded_cues, reviewed_examples=reviewed_examples,
    )

    revision = hashlib.sha256(source).hexdigest()
    canonical = {
        "sourceRevision": revision, "archive": manifest, "analysis": analysis,
        "cues": [{key: row[key] for key in ("id", "start", "end", "japanese", "reading_source")}
                 for row in rows],
        "translations": {
            "eng": {"revision": english_revision, "cues": english},
            "por": {"revision": portuguese_revision, "cues": portuguese},
        },
    }
    return canonical, {"sourceRevision": revision, **projection}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--english", type=Path, required=True)
    parser.add_argument("--english-field", default="translation")
    parser.add_argument("--portuguese", type=Path, required=True)
    parser.add_argument("--portuguese-field", default="translation")
    parser.add_argument("--vocabulary", type=Path, required=True)
    parser.add_argument("--exclude-cue", action="append", default=[], metavar="CUE_ID")
    parser.add_argument("--reviewed-examples", type=Path, metavar="JSON")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    reviewed = json.loads(args.reviewed_examples.read_bytes()) if args.reviewed_examples else ()
    canonical, practice = prepare(
        args.manifest, args.english, args.english_field, args.portuguese, args.portuguese_field,
        args.vocabulary, excluded_cues=args.exclude_cue, reviewed_examples=reviewed,
    )
    args.out.mkdir(mode=0o700, parents=True, exist_ok=True)
    for filename, document in (("canonical.json.gz", canonical), ("practice.json", practice)):
        data = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode()
        with (args.out / filename).open("xb") as output:
            output.write(gzip.compress(data, mtime=0) if filename.endswith(".gz") else data)
    print(json.dumps({
        "sourceRevision": practice["sourceRevision"], "cues": len(canonical["cues"]),
        "practiceCues": len(practice["cues"]), "examples": len(practice["examples"]),
    }))


if __name__ == "__main__":
    main()
