"""Compile contextual Practice questions against the exact archived source and vocabulary."""

import re
from bisect import bisect_left
from collections import Counter, defaultdict

import jaconv

from yomiru.japanese import JapaneseRenderer, source_forms
from yomiru.practice_context import (
    PRACTICE_GRAMMAR,
    cue_readings,
    gloss_key,
    practice_coverage_rows,
)
from yomiru.practice_lexemes import duplicate_credits, expression_spans, validate_expressions
from yomiru.practice_pronouns import group_pronoun_problem, group_pronouns
from yomiru.vocabulary import anchor_identity
from yomiru.vocabulary import digest as vocabulary_digest


def correct_readings(written, readings, corrections):
    kana, romaji, _, spans, names = readings
    for edit in sorted(corrections, key=lambda edit: edit["start"], reverse=True):
        start, end = edit["start"], edit["end"]
        if written[start:end] != edit["form"]:
            raise ValueError("Reading correction no longer matches the source span")
        first = next(p for (a, _), p in spans.items() if a == start)
        last = next(p for (_, b), p in spans.items() if b == end)
        hs, he, rs, re = first[0], last[1], first[2], last[3]
        if kana[hs:he] != edit["beforeKana"] or romaji[rs:re] != edit["beforeRomaji"]:
            raise ValueError("Reading correction no longer matches the generated reading")
        kana = kana[:hs] + edit["kana"] + kana[he:]
        romaji = romaji[:rs] + edit["romaji"] + romaji[re:]
        hd, rd = len(edit["kana"]) - (he - hs), len(edit["romaji"]) - (re - rs)
        spans = {key: (p if key[1] <= start else (p[0] + hd, p[1] + hd, p[2] + rd, p[3] + rd))
                 for key, p in spans.items() if key[1] <= start or key[0] >= end}
        corrected = edit["romaji"]
        leading = len(corrected) - len(corrected.lstrip())
        spans[start, end] = (hs, he + hd, rs + leading, rs + len(corrected.rstrip()))
    return kana, romaji, spans, names


def remove_repeated_romaji_punctuation(written, romaji, spans):
    # Cutlet can copy following punctuation into a small-tsu interjection token.
    # Keep the punctuation token itself and rebase every offset after the copy.
    copies = sorted({
        re - 1 for (_, end), (_, _, rs, re) in spans.items()
        if end < len(written) and written[end - 1] in "っッ" and written[end] in ".?!。？！"
        and rs < re < len(romaji)
        and romaji[re - 1] in ".?!" and romaji[re - 1] == romaji[re]
        and (end, end + 1) in spans and spans[end, end + 1][2] == re
    })
    if not copies:
        return romaji, spans
    removed = set(copies)
    romaji = "".join(char for index, char in enumerate(romaji) if index not in removed)
    spans = {
        span: (hs, he, rs - bisect_left(copies, rs), re - bisect_left(copies, re))
        for span, (hs, he, rs, re) in spans.items()
    }
    return romaji, spans


def corrected_tokens(written, tokens, replacements):
    for edit in replacements:
        start, end = edit["start"], edit["end"]
        if not 0 <= start < end <= len(written) or written[start:end] != edit["form"]:
            raise ValueError("Reviewed word boundary no longer matches the source")
        covered = sorted((a, b) for a, b in tokens if a < end and start < b)
        if not covered or covered[0][0] != start or covered[-1][1] != end:
            raise ValueError("Reviewed word boundary must cover whole archived tokens")
        for span in covered:
            del tokens[span]
        tokens[start, end] = edit["wordId"]
    return dict(sorted(tokens.items()))


def supplemental_words(words, review):
    supplemental = {}
    for row in review.get("supplementalWords", []):
        word_id = row["id"]
        expected = "ja-" + vocabulary_digest([
            "reviewed-expression", row["word"], row["reading"], row["pos"],
        ])
        if word_id != expected and (
            row.get("registry") is not True or not re.fullmatch(r"ja-[a-f0-9]{64}", word_id)
        ):
            raise ValueError("Reviewed vocabulary requires a stable ID")
        if word_id in words or not all(row.get(k) for k in ("word", "reading", "romaji", "pos")):
            raise ValueError("Invalid supplemental vocabulary entry")
        words[word_id] = row
    for word_id, meaning in review.get("supplementalMeanings", {}).items():
        item = words[word_id]
        if not isinstance(meaning, str) or not gloss_key(meaning) or len(meaning) > 100:
            raise ValueError("Invalid reviewed vocabulary meaning")
        supplemental[word_id] = [
            word_id, item["reading"], item["romaji"], meaning, item["reading"], gloss_key(meaning),
            [gloss_key(meaning)], 1, False, item["pos"].split("/")[0], None, item["word"],
        ]
        words[word_id] = {**item, "meanings": {"eng": [meaning]}}
    return supplemental


def choice_key(label):
    key = re.sub(r"\s*\([^)]*\)", "", gloss_key(label)).strip()
    return re.sub(r"^(?:to|a|an|the) ", "", key)


def prepare(source, translation, vocabulary, review, *, check_aliases=False):
    if (source["anchor"] != vocabulary["anchor"]
            or anchor_identity(source["cues"]) != source["anchor"]
            or translation["sourceRevision"] != source["id"] or translation["language"] != "eng"
            or translation["provenance"] != "paired" or review["sourceRevision"] != source["id"]
            or review["translationId"] != translation["id"]):
        raise ValueError("The review, source, vocabulary and paired English revisions must agree")
    english = {row["id"]: row for row in translation["cues"]}
    if len(english) != len(source["cues"]) or len(english) != len(translation["cues"]):
        raise ValueError("Incomplete or duplicate paired translations")
    cue_ids = {cue["id"] for cue in source["cues"]}
    for kind in ("readings", "segments", "exclusions", "peeks", "expressionExceptions"):
        if set(review.get(kind, {})) - cue_ids:
            raise ValueError(f"Unknown source cue in reviewed {kind}")
    words = {row["id"]: row for row in vocabulary["words"]}
    supplemental = supplemental_words(words, review)
    reviewed = defaultdict(list)
    used_answers = defaultdict(set)
    for target in review["targets"]:
        reviewed[target["cue"]].append(target)

    renderer = JapaneseRenderer()
    cues, coverage = [], {}
    for cue in source["cues"]:
        cue_id = cue["id"]
        line = english[cue_id]
        if (line["start"], line["end"]) != (cue["start"], cue["end"]) or not line["text"].strip():
            raise ValueError(f"Invalid paired English for {cue_id}")
        written = cue["japanese"]
        corrections = review.get("readings", {}).get(cue_id, [])
        readings = cue_readings(renderer, written, cue["reading_source"])
        if readings is None and corrections:
            # Explicit reviewed readings can recover cues with source furigana.
            readings = cue_readings(renderer, written, written)
        if readings is None and (cue_id in reviewed or corrections):
            raise ValueError(f"No aligned readings for reviewed cue {cue_id}")
        kana, romaji, spans, names = (correct_readings(written, readings, corrections)
                                     if readings else (None, None, {}, {}))
        if romaji:
            romaji, spans = remove_repeated_romaji_punctuation(written, romaji, spans)
        tokens = {tuple(span): None if index is None else source["wordIds"][index]
                  for *span, index in cue["tokens"]}
        if len(tokens) != len(cue["tokens"]):
            raise ValueError(f"Duplicate source token in {cue_id}")
        archived_tokens = [(a, b, key) for (a, b), key in tokens.items()]
        groups = list(group_pronouns(written, archived_tokens, words)) if check_aliases else []
        exclusions = review.get("exclusions", {}).get(cue_id, [])
        # Caption directions can retain written text without any spoken tokens.
        if (not tokens and written and exclusions == [[0, len(written), "-sound"]]
                and not source_forms(written)[0]):
            tokens[0, len(written)] = None
        tokens = corrected_tokens(written, tokens, review.get("segments", {}).get(cue_id, []))
        starts = {start: span for (start, _), span in spans.items()}
        ends = {end: span for (_, end), span in spans.items()}
        peek_spans = {}
        for (start, end), word_id in tokens.items():
            if word_id is not None and start in starts and end in ends:
                hs, _, rs, _ = starts[start]
                _, he, _, re_ = ends[end]
                if hs < he and rs < re_:
                    peek_spans[start, end] = [word_id, hs, he, rs, re_]
        # A dictionary word can cover several reading tokens, including name-like parts.
        word_spans = tuple(peek_spans)
        for (start, end), name in names.items():
            if (start, end) in spans and not any(a < end and start < b for a, b in word_spans):
                peek_spans[start, end] = [name, *spans[start, end]]
        reviewed_peeks = set()
        for peek in review.get("peeks", {}).get(cue_id, []):
            start, end = peek["start"], peek["end"]
            form, gloss, reading = peek["form"], peek["gloss"], peek["reading"]
            entry = peek["jmdictEntryId"]
            if not (0 <= start < end <= len(written) and (start, end) not in reviewed_peeks
                    and written[start:end] == form and start in starts and end in ends
                    and type(entry) is int and entry > 0 and 1 <= len(gloss.strip()) <= 100):
                raise ValueError(f"Invalid reviewed word peek in {cue_id}")
            hs, _, rs, _ = starts[start]
            _, he, _, re_ = ends[end]
            if hs >= he or rs >= re_ or jaconv.kata2hira(kana[hs:he]) != reading:
                raise ValueError(f"Unaligned reviewed word peek in {cue_id}")
            word = tokens.get((start, end)) or "ja-" + vocabulary_digest(["jmdict", entry, reading])
            peek_spans[start, end] = [word, hs, he, rs, re_, form, gloss.strip()]
            reviewed_peeks.add((start, end))
        peeks = [peek_spans[span] for span in sorted(peek_spans)]
        questions = []
        credited = set()
        cue_targets = sorted(reviewed.pop(cue_id, []), key=lambda target: target["start"])
        for target in cue_targets:
            start, end = target["start"], target["end"]
            word_id = target["wordId"]
            if written[start:end] != target["form"] or word_id not in words:
                raise ValueError(f"Invalid reviewed form or vocabulary ID for {cue_id}")
            heads = [
                (a, b) for (a, b), key in tokens.items() if start <= a < b <= end and word_id == key
            ]
            if len(heads) != 1:
                raise ValueError(f"Target must identify one vocabulary occurrence in {cue_id}")
            item = words[word_id]
            if item["pos"].split("/")[0] in PRACTICE_GRAMMAR:
                raise ValueError(f"Standalone grammatical fragment in {cue_id}")
            if not item["meanings"].get("eng"):
                raise ValueError(f"Vocabulary entry has no English senses in {cue_id}")
            beginning = starts.get(start)
            ending = ends.get(end)
            if beginning is None or ending is None or beginning[2] >= ending[3] or (
                questions and beginning[0] < questions[-1][2]
            ):
                raise ValueError(f"Unaligned or overlapping reviewed span in {cue_id}")
            choices = target["choices"]
            if (not 2 <= len(choices) <= 4
                    or any(not isinstance(text, str) or not text.strip() or len(text) > 100
                           for text in choices)
                    or len({gloss_key(choice) for choice in choices}) != len(choices)):
                raise ValueError(f"Invalid choices for {cue_id}")
            if check_aliases:
                alternatives = {choice_key(choice) for choice in choices[1:]}
                senses = {choice_key(meaning) for meaning in item["meanings"]["eng"]}
                if choice_key(choices[0]) in alternatives or alternatives & senses:
                    raise ValueError(f"An alternative is a known meaning of the target in {cue_id}")
                used_answers[word_id].add(gloss_key(choices[0]))
            questions.append([
                word_id, beginning[0], ending[1], beginning[2], ending[3], choices, [start, end],
            ])
            credited.add(heads[0])
        if groups:
            problem = group_pronoun_problem(
                groups, cue_targets, words, kana, romaji, spans,
            )
            if problem:
                raise ValueError(f"{cue_id}: {problem}")
        if check_aliases:
            problem = validate_expressions(
                written, expression_spans(written, archived_tokens), cue_targets, words,
                review.get("expressionExceptions", {}).get(cue_id, ()),
            )
            if problem:
                raise ValueError(f"{cue_id}: {problem}")
        dispositions = {}
        for a, b, reason in exclusions:
            if (a, b) not in tokens or (a, b) in dispositions or (a, b) in credited:
                raise ValueError(f"Invalid reviewed disposition in {cue_id}")
            if reason == "~":
                if not any(t["start"] <= a < b <= t["end"] for t in cue_targets):
                    raise ValueError(f"Uncovered part of a reviewed expression in {cue_id}")
                reason = "part_of_question"
            elif reason in {
                "-compound", "-construction", "-counter", "-formula", "-fragment",
                "-idiom", "-misparsed", "-name", "-sound",
            }:
                reason = "reviewed_" + reason[1:]
            else:
                raise ValueError(f"Unknown reviewed disposition in {cue_id}")
            dispositions[a, b] = reason
        cues.append([cue_id, kana, romaji, peeks, line["text"], questions])
        coverage[cue_id] = {
            "japanese": written,
            "spans": practice_coverage_rows(written, tokens, words, spans, credited, dispositions),
        }
    if reviewed or not cues:
        raise ValueError("Review contains unknown cues or the source has no cues")
    if set(supplemental) - {question[0] for row in cues for question in row[5]}:
        raise ValueError("Supplemental vocabulary must be used by a reviewed question")
    if check_aliases:
        credited_words = {key: words[key] for key in used_answers}
        duplicate = next(duplicate_credits(credited_words, used_answers), None)
        if duplicate:
            keys = ", ".join(duplicate["wordIds"])
            labels = " / ".join(duplicate["headwords"])
            reading = duplicate["reading"]
            raise ValueError(f"Use one mastery entry for {labels}【{reading}】: {keys}")
    return {"version": 1, "kind": "practice-cues", "anchor": source["anchor"],
            "sourceRevision": source["id"],
            "prepared": True, "translationId": translation["id"], "cues": cues,
            "coverage": coverage, "examples": [],
            **({"supplementalCards": list(supplemental.values())} if supplemental else {})}



def coverage_counts(payload, *, require_complete=False):
    counts = Counter(status for cue in payload["coverage"].values() for *_, status in cue["spans"])
    unresolved = {status: counts[status] for status in (
        "needs_review", "unaligned", "missing_entry", "missing_meaning", "unparsed",
    ) if counts[status]}
    if require_complete and unresolved:
        raise ValueError(f"Episode has unresolved Practice occurrences: {unresolved}")
    return counts
