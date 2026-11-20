"""Prepare validated subtitle inputs for private database storage."""

import gzip
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

from yomiru.captions import Cue, milliseconds, parse_document, plain_text
from yomiru.japanese import Script, source_forms
from yomiru.practice_context import practice_projection
from yomiru.render import Appearance, render_ass, timestamp
from yomiru.vocabulary import anchor_identity


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def read_verified(path, sha256, size):
    data = path.read_bytes()
    if len(data) != size or digest(data) != sha256:
        raise ValueError(f"Checksum mismatch for {path.name}")
    return data


def archived_source(manifest_path, anchor):
    raw = manifest_path.read_bytes()
    revision = digest(raw)
    manifest = json.loads(raw)
    if manifest["anchor"] != anchor:
        raise ValueError("Private source archive does not match the publication")
    root = manifest_path.parent.parent
    inputs = {}
    for label, namespace, ext in (("original", "sources", r"(?:ass|ssa|srt|vtt)"),
                                  ("analysis", "analyses", r"json\.gz")):
        descriptor = manifest[label]
        if not re.fullmatch(rf"{namespace}/[0-9a-f]{{64}}\.{ext}", descriptor["path"]):
            raise ValueError(f"Invalid archive {label} path")
        inputs[label] = read_verified(
            root / descriptor["path"], descriptor["sha256"], descriptor["bytes"],
        )
    analysis = json.loads(gzip.decompress(inputs["analysis"]))
    if analysis["anchor"] != anchor or analysis["offsets"] != "unicode-codepoints":
        raise ValueError("Private token analysis does not match the Japanese source")
    suffix = Path(manifest["original"]["path"]).suffix[1:]
    original = parse_document(inputs["original"].decode("utf-8-sig"), suffix)
    by_text = defaultdict(set)
    for cue in original:
        for spelling in {cue.text, source_forms(cue.text)[0]}:
            by_text[cue.start, cue.end, spelling].add(cue.text)
        # Some archived publications kept full-cue sound descriptions as text.
        annotation = r"(?:（[^（）]+）|\([^()]+\))"
        if re.fullmatch(rf"{annotation}(?:\s+{annotation})*", cue.text):
            visible = " ".join(part[1:-1].strip() for part in re.findall(annotation, cue.text))
            by_text[cue.start, cue.end, visible].add(visible)
    rows = []
    for cue in analysis["cues"]:
        written = cue.get("japanese", cue["text"])
        available = by_text[cue["start"], cue["end"], written]
        if len(available) != 1:
            raise ValueError(f"Could not resolve original reading input for {anchor}/{cue['id']}")
        rows.append({"id": cue["id"], "start": cue["start"], "end": cue["end"],
                     "japanese": written, "reading_source": next(iter(available)),
                     "tokens": cue["tokens"]})
    if anchor_identity(rows) != anchor:
        raise ValueError("Reconstructed Japanese cue identities do not match the publication")
    source = {"id": revision, "anchor": anchor, "wordIds": analysis["wordIds"], "cues": rows}
    return source, analysis


def ass_parts(data):
    """Split the style header from exact ordered event lines, retaining endings."""
    text = data.decode("utf-8")
    section = re.search(r"(?im)^\[events\][ \t]*\r?$\n", text)
    if section is None:
        raise ValueError("Published ASS is missing its Events section")
    head = text[:section.end()]
    lines = text[section.end():].split("\n")
    return head, lines


def rendered_translation(lines):
    fields = []
    translated = []
    for line in lines:
        label, _, content = line.partition(":")
        if label == "Format":
            fields = [field.strip().lower() for field in content.split(",")]
        if label != "Dialogue":
            continue
        if not fields or fields[-1] != "text":
            raise ValueError("Rendered translation has no usable ASS event format")
        values = dict(zip(fields, content.split(",", len(fields) - 1), strict=True))
        if values["style"].strip().casefold() not in {"english", "portuguese", "translation"}:
            continue
        text = plain_text(values["text"])
        if text:
            start, end = milliseconds(values["start"]), milliseconds(values["end"])
            Cue(start, end, text)
            translated.append({"start": start, "end": end, "text": text})
    if not translated:
        raise ValueError("Published ASS has no identifiable translation timeline")
    return translated


def paired_translation(path, generation, source, language):
    data = path.read_bytes()
    if digest(data) != generation:
        raise ValueError("Retained translation pairs do not match the published generation")
    cues = json.loads(data)["cues"]
    if anchor_identity(cues) != source["anchor"]:
        return None
    if [row["id"] for row in cues] != [row["id"] for row in source["cues"]]:
        raise ValueError("Retained translation pairs have different cue IDs")
    audited = "audited_english" if language == "eng" else "audited_translation"
    translated = [{"id": row["id"], "start": row["start"], "end": row["end"],
                   "text": row.get(audited, row.get("translation"))} for row in cues]
    if any(not isinstance(row["text"], str) or not row["text"].strip() for row in translated):
        raise ValueError("An exact translation input has missing text")
    return translated


def translations_for_practice(source, translation):
    if translation["provenance"] == "paired":
        return {row["id"]: row["text"] for row in translation["cues"]}
    # Rendered copies may have merged cues. Only exact, unambiguous timing
    # matches qualify as lexical evidence for an individual prompt.
    by_time = defaultdict(set)
    for cue in translation["cues"]:
        by_time[timestamp(cue["start"]), timestamp(cue["end"])].add(cue["text"])
    aligned = {}
    for cue in source["cues"]:
        matches = by_time[timestamp(cue["start"]), timestamp(cue["end"])]
        if len(matches) == 1:
            aligned[cue["id"]] = next(iter(matches))
    return aligned


def rebuild_ass(source, translation, script):
    japanese = [Cue(row["start"], row["end"], row["reading_source"]) for row in source["cues"]]
    base = [Cue(row["start"], row["end"], row["text"]) for row in translation["cues"]]
    return render_ass(japanese, base, Script(script), Appearance(), base_label="AI translation")


def prepare_corpus(index, archives, pairs, assets, vocabularies, *, practice_reviews=None):
    practice_reviews = practice_reviews or {}
    sources, analyses, titles = {}, {}, {}
    for entry in index["vocabulary"]:
        anchor = entry["anchor"]
        if anchor not in sources:
            sources[anchor], analyses[anchor] = archived_source(Path(archives[anchor]), anchor)
        for title in entry["videoIds"]:
            if title in titles and titles[title] != anchor:
                raise ValueError("One published video ID references different Japanese anchors")
            titles[title] = anchor

    renditions, groups = {}, defaultdict(list)
    for track in index["tracks"]:
        sha = track["sha256"]
        if not re.fullmatch(r"[0-9a-f]{64}", sha) or track["path"] != f"/library/{sha}.ass":
            raise ValueError("Invalid published track descriptor")
        if sha not in renditions:
            data = read_verified(assets / f"{sha}.ass", sha, track["bytes"])
            head, lines = ass_parts(data)
            renditions[sha] = {"sha256": sha, "bytes": len(data), "header": head, "events": lines}
        groups[track.get("anchor"), track["lang"], track["generation"]].append(track)

    translations, track_inputs, available = [], {}, defaultdict(list)
    for (anchor, language, generation), tracks in groups.items():
        source = sources.get(anchor)
        if not source or language == "jpn":
            continue
        cues = (paired_translation(Path(pairs[generation]), generation, source, language)
                if generation in pairs else None)
        proven = cues is not None
        representative = min(tracks, key=lambda t: (t["script"] != "japanese", t["id"]))
        if not proven:
            cues = rendered_translation(renditions[representative["sha256"]]["events"])
        translation = {
            "sourceRevision": source["id"], "language": language,
            "provenance": "paired" if proven else "rendered", "generation": generation,
            "trackId": representative["id"], "cues": cues,
        }
        translation["id"] = digest(encoded(translation))
        translations.append(translation)
        for track in tracks:
            track_inputs[track["id"]] = translation["id"]
            for title in track["videoIds"]:
                if titles.get(title) == anchor:
                    available[title, language].append(translation)

    chosen = {}
    for key, candidates in available.items():
        source = sources[titles[key[0]]]
        chosen[key] = max(candidates, key=lambda row: (
            row["provenance"] == "paired", len(translations_for_practice(source, row)), row["id"],
        ))

    contexts = []
    for anchor, source in sources.items():
        video_ids = sorted(title for title, value in titles.items() if value == anchor)
        english = next((chosen[title, "eng"] for title in video_ids if (title, "eng") in chosen),
                       None)
        vocabulary = json.loads((vocabularies / f"{anchor}.json").read_bytes())
        if vocabulary["anchor"] != anchor:
            raise ValueError("Practice glossary does not match its archived source")
        reviews = practice_reviews.get(anchor, {})
        projection = practice_projection(
            analyses[anchor], {row["id"]: row for row in source["cues"]},
            translations_for_practice(source, english) if english else {}, vocabulary,
            excluded_cues=reviews.get("excludedCues", ()),
            reviewed_examples=reviews.get("examples", ()),
        )
        contexts.append({"sourceRevision": source["id"], **projection})

    coverage = {(title, track["lang"]) for track in index["tracks"]
                for title in track["videoIds"] if track.get("anchor") == titles.get(title)
                and track["lang"] != "jpn"}
    if chosen.keys() != coverage:
        raise ValueError("Corpus does not cover all published anchored title and language pairs")
    return {
        "version": 1, "publication": index["revision"], "sources": list(sources.values()),
        "translations": translations, "renditions": list(renditions.values()), "contexts": contexts,
        "titles": [{"videoId": title, "sourceRevision": sources[anchor]["id"], "anchor": anchor}
                   for title, anchor in titles.items()],
        "choices": [{"videoId": title, "language": language, "translationId": row["id"]}
                    for (title, language), row in chosen.items()],
        "tracks": [{"descriptor": track, "translationId": track_inputs.get(track["id"])}
                   for track in index["tracks"]],
    }
