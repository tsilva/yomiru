"""Stream entries for prepopulating Yomiru's shared dictionary from JMdict."""

import hashlib
from pathlib import Path

import jaconv

from yomiru.translation import digest
from yomiru.vocabulary import ATTRIBUTION, POS_PREFIXES, compatible_pos, simplified_entries


def seed_rows(path: Path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("Supply a regular JMdict archive below 32 MiB")
    with path.open("rb") as stream:
        source = {**ATTRIBUTION, "sha256": hashlib.file_digest(stream, "sha256").hexdigest()}

    for entry in simplified_entries(path):
        entry_id = int(entry["id"])
        kanji = [item["text"] for item in entry["kanji"]]
        by_reading = {}
        for variant in entry["kana"]:
            kana = variant["text"]
            reading = jaconv.kata2hira(kana)
            restrictions = variant["appliesToKanji"]
            forms = [form for form in kanji if "*" in restrictions or form in restrictions]
            forms.append(kana)
            record = by_reading.setdefault(reading, {"forms": [], "senses": []})
            record["forms"].extend(form for form in forms if form not in record["forms"])
            inherited = []
            for sense in entry["sense"]:
                inherited = sense["partOfSpeech"] or inherited
                kana_scope = sense["appliesToKana"]
                if "*" not in kana_scope and kana not in kana_scope:
                    continue
                kanji_scope = sense["appliesToKanji"]
                applicable = [form for form in forms if "*" in kanji_scope or form in kanji_scope]
                glosses = list(dict.fromkeys(gloss["text"] for gloss in sense["gloss"]
                                             if gloss["lang"] == "eng" and gloss["text"]))
                compatible = [pos for pos in POS_PREFIXES if compatible_pos(pos, inherited)]
                candidate = {"forms": applicable, "pos": compatible, "eng": glosses}
                verb_classes = [
                    tag for tag in inherited if tag.startswith("v") and tag not in {"vi", "vt"}
                ]
                if verb_classes:
                    candidate["verbClasses"] = verb_classes
                if applicable and glosses and candidate not in record["senses"]:
                    record["senses"].append(candidate)

        for reading, record in by_reading.items():
            forms, senses = record["forms"], record["senses"]
            if not senses:
                continue
            headword = next(form for form in forms
                            if any(form in sense["forms"] for sense in senses))
            meanings = list(dict.fromkeys(gloss for sense in senses if headword in sense["forms"]
                                          for gloss in sense["eng"]))
            word_id = "ja-" + digest(["jmdict", entry_id, reading])
            yield {"id": word_id, "jmdict_entry_id": entry_id, "detail": {
                "id": word_id, "word": headword, "reading": reading, "romaji": "", "pos": "",
                "aliases": forms, "meanings": {"eng": meanings},
                "meaningStatus": {"eng": "dictionary"}, "sources": {"eng": [source["sha256"]]},
                "dictionaries": [source], "jmdictSenses": senses,
            }}
