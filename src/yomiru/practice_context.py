"""Prepare private, cue-aligned subtitle bundles and quiz examples offline."""

import re
import unicodedata
from collections import Counter, defaultdict

import jaconv
from cutlet.cutlet import normalize_text

from yomiru.japanese import JapaneseRenderer, source_forms


def offsets(text, surfaces):
    start = 0
    for surface in surfaces:
        start = text.index(surface, start)
        end = start + len(surface)
        yield start, end
        start = end


def gloss_key(text):
    return " ".join(unicodedata.normalize("NFKC", text).lower().split()).rstrip(".?!")


def cue_readings(renderer, text, reading_source):
    _, reading = source_forms(reading_source)
    # The source-to-render spans must have an exact alignment. Leave ruby
    # replacements and normalization that changes offsets to standalone review.
    if reading != text:
        return None
    romanizer = renderer.romanizer
    kana_parts = [(token.surface, jaconv.kata2hira(token.feature.kana or token.surface))
                  for token in romanizer.tagger(text)]
    kana = "".join(part for _, part in kana_parts)
    kana_spans = dict(zip(offsets(text, (s for s, _ in kana_parts)),
                          offsets(kana, (s for _, s in kana_parts)), strict=True))
    normalized = normalize_text(text)
    if len(normalized) != len(text):
        return None
    tokens = list(romanizer.tagger(normalized))
    parts = romanizer.romaji_tokens(tokens)
    source_spans = list(offsets(normalized, (token.surface for token in tokens)))
    pos = [(token.feature.pos1, token.feature.pos2) for token in tokens]
    romaji = "".join(map(str, parts)).strip()
    if (not kana or not romaji or len(kana) > 100 or len(romaji) > 160
            or re.search(r"[一-龯々]", kana) or re.search(r"[ぁ-ゖァ-ヺ一-龯々]", romaji)):
        return None
    romaji_spans = list(offsets(romaji, (part.surface for part in parts)))
    targets = {}
    for index, span in enumerate(source_spans):
        if span not in kana_spans or not parts[index].surface:
            continue
        end = index
        if pos[index][0] in {"動詞", "形容詞"}:
            while end + 1 < len(parts) and not parts[end].space and (
                pos[end + 1][0] == "助動詞" or pos[end + 1][1] == "接続助詞"
            ) and source_spans[end + 1] in kana_spans:
                end += 1
        targets[span] = (kana_spans[span][0], kana_spans[source_spans[end]][1],
                         romaji_spans[index][0], romaji_spans[end][1])
    return kana, romaji, targets


def practice_projection(analysis, source_rows, english, vocabulary, *,
                        excluded_cues=(), reviewed_examples=()):
    excluded = set(excluded_cues)
    if excluded - source_rows.keys():
        raise ValueError("Practice exclusions must identify cues in the archived source")
    primary_glosses, glosses = {}, {}
    for word in vocabulary["words"]:
        part_of_speech = word["pos"].split("/", 1)[0]
        if part_of_speech == "助詞":
            continue
        keys = (gloss_key(text) for text in word["meanings"].get("eng", [])
                if len(text.strip().encode("utf-16-le")) <= 200)
        meaning = next((key for key in keys if key), "")
        if not meaning:
            continue
        primary_glosses[word["id"]] = meaning
        if part_of_speech not in {"名詞", "動詞", "形容詞", "形状詞", "副詞"}:
            continue
        phrase = meaning.removeprefix("to ")
        if re.fullmatch(r"[a-z]{3,}(?: [a-z]{2,}){0,3}", phrase):
            glosses[word["id"]] = re.compile(rf"\b{re.escape(phrase)}\b")

    reviewed = {}
    for cue, word, gloss in reviewed_examples:
        if (cue, word) in reviewed or cue in excluded or primary_glosses.get(word) != gloss:
            raise ValueError(f"Duplicate, excluded cue or stale gloss in reviewed example: {cue}")
        reviewed[cue, word] = gloss
    reviewed_cues = {cue for cue, _ in reviewed}
    remaining_reviews = set(reviewed)
    reserved = Counter(word for _, word in reviewed)

    renderer = JapaneseRenderer()
    examples, cues = [], []
    seen_examples = defaultdict(set)
    # Reserve space for reviewed examples before adding literal matches.
    for cue in sorted(analysis["cues"], key=lambda cue: cue["id"] not in reviewed_cues):
        cue_id = cue["id"]
        if cue_id in excluded or not 5 <= len(cue["text"]) <= 36:
            continue
        context = cue_readings(renderer, cue["text"], source_rows[cue_id]["reading_source"])
        if context is None:
            continue
        hiragana, romaji, spans = context
        line = (hiragana, romaji)
        translated = gloss_key(english.get(cue_id, ""))
        matches = {}
        for start, end, word_index in cue["tokens"]:
            if word_index is None or (start, end) not in spans:
                continue
            word = analysis["wordIds"][word_index]
            if word in matches:
                continue
            if len(seen_examples[word]) >= 2 or line in seen_examples[word]:
                continue
            key = (cue_id, word)
            pattern = glosses.get(word)
            if key not in reviewed:
                if len(seen_examples[word]) + reserved[word] >= 2:
                    continue
                if pattern is None or not pattern.search(translated):
                    continue
            else:
                reserved[word] -= 1
            matches[word] = [cue_id, word, primary_glosses[word], *spans[start, end]]
            seen_examples[word].add(line)
            remaining_reviews.discard(key)
        if matches:
            cues.append([cue_id, hiragana, romaji])
            examples.extend(matches.values())
    if remaining_reviews:
        raise ValueError(f"Unresolved reviewed examples: {sorted(remaining_reviews)}")

    return {"cues": cues, "examples": examples, "excludedCues": sorted(excluded)}
