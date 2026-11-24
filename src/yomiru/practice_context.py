"""Prepare private, cue-aligned subtitle bundles and quiz examples offline."""

import re
import unicodedata

import jaconv
from cutlet.cutlet import normalize_text

from yomiru.japanese import KANJI, JapaneseRenderer, mixed_kana, source_forms

PARTICLE = "助詞"
PRACTICE_GRAMMAR = {PARTICLE, "助動詞", "接頭辞", "接尾辞"}


def practice_coverage_rows(written, tokens, words, spans, targets, dispositions=None):
    """Partition the written cue, including tokens without a scored question."""
    position = 0
    rows = []
    for (start, end), word_id in tokens.items():
        if not position <= start < end <= len(written):
            raise ValueError("Invalid or overlapping source tokens")
        if position < start:
            gap = written[position:start]
            status = "unparsed" if any(c.isalnum() for c in gap) else "separator"
            rows.append([position, start, None, status])
        if (start, end) in targets:
            status = "ready"
        elif dispositions and (start, end) in dispositions:
            status = dispositions[start, end]
        elif word_id is None:
            surface = written[start:end]
            status = "source_excluded" if any(c.isalnum() for c in surface) else "separator"
        elif word_id not in words:
            status = "missing_entry"
        elif words[word_id]["pos"].split("/")[0] in PRACTICE_GRAMMAR:
            status = "grammar"
        elif (start, end) not in spans:
            status = "unaligned"
        elif not words[word_id]["meanings"].get("eng"):
            status = "missing_meaning"
        else:
            status = "needs_review"
        rows.append([start, end, word_id, status])
        position = end
    if position < len(written):
        status = "unparsed" if any(c.isalnum() for c in written[position:]) else "separator"
        rows.append([position, len(written), None, status])
    return rows


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
    # Skip this cue if ruby replacements prevent exact source-to-render alignment.
    if reading != text:
        return None
    romanizer = renderer.romanizer
    kana_parts = [(token.surface, mixed_kana(token.surface, token.feature.kana))
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
    if (not re.search(r"[ぁ-ゖァ-ヺ]", kana) or not re.search(r"[a-zA-Z]", romaji)
            or len(kana) > 100 or len(romaji) > 160
            or KANJI.search(kana) or KANJI.search(romaji) or re.search(r"[ぁ-ゖァ-ヺ]", romaji)):
        return None
    romaji_spans = list(offsets(romaji, (part.surface for part in parts)))
    targets, words, names = {}, {}, {}
    for index, span in enumerate(source_spans):
        if span not in kana_spans:
            continue
        token = tokens[index]
        if not parts[index].surface:
            # A small tsu can end a reviewed interjection without adding a Roman letter.
            if token.surface in {"っ", "ッ"}:
                words[span] = (*kana_spans[span], *romaji_spans[index])
            continue
        words[span] = (*kana_spans[span], *romaji_spans[index])
        if pos[index][1] == "固有名詞" and token.feature.kana not in {None, "", "*"}:
            names[span] = [token.surface, jaconv.kata2hira(token.feature.kana)]
        end = index
        if pos[index][0] in {"動詞", "形容詞"}:
            while end + 1 < len(parts) and not parts[end].space and (
                pos[end + 1][0] == "助動詞" or pos[end + 1][1] == "接続助詞"
            ) and source_spans[end + 1] in kana_spans:
                end += 1
        targets[span] = (kana_spans[span][0], kana_spans[source_spans[end]][1],
                         romaji_spans[index][0], romaji_spans[end][1])
    return kana, romaji, targets, words, names


def practice_projection(analysis, source_rows, english, vocabulary, *,
                        excluded_cues=(), reviewed_examples=()):
    excluded = set(excluded_cues)
    if excluded - source_rows.keys():
        raise ValueError("Practice exclusions must identify cues in the archived source")
    primary_glosses, glosses = {}, {}
    for word in vocabulary["words"]:
        part_of_speech = word["pos"].split("/", 1)[0]
        if part_of_speech == PARTICLE:
            continue
        keys = (gloss_key(text) for text in word["meanings"].get("eng", [])
                if len(text.strip().encode("utf-16-le")) <= 200)
        key = next((key for key in keys if key), "")
        if not key:
            continue
        primary_glosses[word["id"]] = key
        if part_of_speech not in {"名詞", "動詞", "形容詞", "形状詞", "副詞"}:
            continue
        phrase = key.removeprefix("to ")
        if re.fullmatch(r"[a-z]{3,}(?: [a-z]{2,}){0,3}", phrase):
            glosses[word["id"]] = re.compile(rf"\b{re.escape(phrase)}\b")

    reviewed = {}
    for cue, word, gloss in reviewed_examples:
        if (cue, word) in reviewed or cue in excluded or primary_glosses.get(word) != gloss:
            raise ValueError(f"Duplicate, excluded cue or stale gloss in reviewed example: {cue}")
        reviewed[cue, word] = gloss
    remaining_reviews = set(reviewed)

    renderer = JapaneseRenderer()
    cues, first, alternate = {}, {}, {}
    for cue in analysis["cues"]:
        cue_id = cue["id"]
        if cue_id in excluded:
            continue
        context = cue_readings(renderer, cue["text"], source_rows[cue_id]["reading_source"])
        if context is None:
            continue
        kana, romaji, spans, word_spans, names = context
        line = (kana, romaji)
        translated = gloss_key(english.get(cue_id, ""))
        seen = set()
        playable = False
        for start, end, word_index in cue["tokens"]:
            if word_index is None or (start, end) not in spans:
                continue
            word = analysis["wordIds"][word_index]
            if word not in primary_glosses or (start, end) not in word_spans:
                continue
            playable = True
            if word in seen:
                continue
            hs, he, rs, re_ = spans[start, end]
            # A subtitle containing only the target and punctuation adds no context.
            if not any(char.isalnum() for char in kana[:hs] + kana[he:]):
                continue
            seen.add(word)
            key = (cue_id, word)
            pattern = glosses.get(word)
            remaining_reviews.discard(key)
            # Keep the earliest usable cue for subtitle order. For rotation,
            # prefer an alternate whose meaning was reviewed or appears in the translation.
            priority = 2 if key in reviewed else int(bool(pattern and pattern.search(translated)))
            example = [cue_id, word, primary_glosses[word], hs, he, rs, re_]
            if word not in first:
                first[word] = (line, example)
            elif line != first[word][0] and priority > alternate.get(word, (-1, None))[0]:
                alternate[word] = (priority, example)
            else:
                continue
        if playable:
            peeks = []
            for start, end, word_index in cue["tokens"]:
                span = (start, end)
                if span not in word_spans:
                    continue
                word = names.get(span) if word_index is None else analysis["wordIds"][word_index]
                if word is not None:
                    peeks.append([word, *word_spans[span]])
            cues[cue_id] = [cue_id, kana, romaji, peeks]
    if remaining_reviews:
        raise ValueError(f"Unresolved reviewed examples: {sorted(remaining_reviews)}")

    examples = [example for _, example in (*first.values(), *alternate.values())]
    return {"cues": [cues[cue_id] for cue_id in sorted(cues)],
            "examples": examples, "excludedCues": sorted(excluded)}
