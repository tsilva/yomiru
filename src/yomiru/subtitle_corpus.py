"""Prepare validated subtitle inputs for private database storage."""

import gzip
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

from yomiru.captions import Cue, milliseconds, parse_document, plain_text
from yomiru.japanese import KANJI, RUBY, JapaneseRenderer, Script, source_forms
from yomiru.practice_context import cue_readings, practice_projection
from yomiru.render import Appearance, render_ass, timestamp
from yomiru.reviewed_practice import correct_readings
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


def reviewed_subtitle_readings(renderer, written, annotated, edits, cue):
    original = renderer.render(annotated, Script.KANA)
    aligned = cue_readings(renderer, written, annotated)
    if aligned and aligned[0] == original:
        return correct_readings(written, aligned, edits)[:2]

    # Practice aligns reviewed ruby cues against their written form. Check
    # that the edits account for every difference in the annotated render.
    aligned = cue_readings(renderer, written, written)
    if aligned:
        corrected = correct_readings(written, aligned, edits)[:2]
        kana, _, _, spans, _ = aligned
        starts = {start: span[0] for (start, _), span in spans.items()}
        ends = {end: span[1] for (_, end), span in spans.items()}
        ruby_by_span = {}
        # A caption can annotate only the end of an adjacent kanji run, such as
        # the given name in a full name. Match that ruby to its exact source span.
        marker = "\0"
        if marker not in annotated:
            for match in RUBY.finditer(annotated):
                marked, _ = source_forms(
                    annotated[:match.start()] + marker + match[1] + marker + annotated[match.end():]
                )
                parts = marked.split(marker)
                if len(parts) == 3 and "".join(parts) == written:
                    prefix, form, _ = parts
                    ruby_by_span[len(prefix), len(prefix) + len(form)] = match[2]
        _, annotated_text = source_forms(annotated)
        with_ruby = written
        for (start, end), ruby in sorted(ruby_by_span.items(), reverse=True):
            with_ruby = with_ruby[:start] + ruby + with_ruby[end:]
        annotated_readings = (
            cue_readings(renderer, with_ruby, with_ruby)
            if ruby_by_span and with_ruby == annotated_text else None
        )
        annotated_starts, annotated_ends = {}, {}
        if annotated_readings and annotated_readings[0] == original:
            annotated_spans = annotated_readings[3]
            annotated_starts = {start: span[0] for (start, _), span in annotated_spans.items()}
            annotated_ends = {end: span[1] for (_, end), span in annotated_spans.items()}
        pattern = []
        cursor = 0
        for edit in sorted(edits, key=lambda edit: edit["start"]):
            start, end = starts[edit["start"]], ends[edit["end"]]
            pattern.append(re.escape(kana[cursor:start]))
            variants = [edit["beforeKana"], edit["kana"]]
            ruby = ruby_by_span.get((edit["start"], edit["end"]))
            if ruby and edit["kana"].endswith(ruby):
                variants.append(ruby)
            # Replacing a surname with ruby can change the tagger's reading of
            # an adjacent unannotated given name. Accept that exact source render.
            first, last = edit["start"], edit["end"]
            if (annotated_starts and KANJI.fullmatch(written[first:last])
                    and any(b == first for _, b in ruby_by_span)
                    and not any(a < last and first < b for a, b in ruby_by_span)):
                shift = sum(
                    len(value) - (b - a) for (a, b), value in ruby_by_span.items() if b <= first
                )
                lo, hi = annotated_starts.get(first + shift), annotated_ends.get(last + shift)
                if lo is not None and hi is not None and lo < hi:
                    variants.append(original[lo:hi])
            pattern.append("(?:" + "|".join(map(re.escape, variants)) + ")")
            cursor = end
        pattern.append(re.escape(kana[cursor:]))
        if re.fullmatch("".join(pattern), original):
            return corrected
    raise ValueError(f"Subtitle reading does not align with the stored cue {cue}")


def rebuild_ass(source, translation, script, *, subtitle_readings=None, playback_ready=False):
    script = Script(script)
    japanese = [Cue(row["start"], row["end"], row["reading_source"]) for row in source["cues"]]
    base = [Cue(row["start"], row["end"], row["text"]) for row in translation["cues"]]
    overrides = {}
    if script in (Script.KANA, Script.ROMAJI) and subtitle_readings:
        positions = {row["id"]: i for i, row in enumerate(source["cues"])}
        if subtitle_readings.keys() - positions.keys():
            raise ValueError("Subtitle readings must identify stored source cues")
        renderer = JapaneseRenderer()
        for cue, edits in subtitle_readings.items():
            i = positions[cue]
            written = source["cues"][i]["japanese"]
            annotated = japanese[i].text
            kana, romaji = reviewed_subtitle_readings(renderer, written, annotated, edits, cue)
            overrides[i] = kana if script == Script.KANA else romaji
    return render_ass(japanese, base, script, Appearance(), base_label="AI translation",
                      learning_overrides=overrides, playback_ready=playback_ready)


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
