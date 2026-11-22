"""Suggest contextual Practice matches and reuse validated private reviews."""

import json
import re
from collections import defaultdict

from yomiru.japanese import JapaneseRenderer
from yomiru.practice_context import PRACTICE_GRAMMAR, cue_readings
from yomiru.practice_lexemes import duplicate_credits, expression_spans, validate_expressions
from yomiru.practice_pronouns import (
    group_entry,
    group_identity,
    group_pronoun_problem,
    group_pronouns,
    singular_answer,
)
from yomiru.registry import write_immutable_asset
from yomiru.reviewed_practice import choice_key, correct_readings
from yomiru.subtitle_corpus import digest, encoded

REVIEW_FIELDS = ("readings", "segments", "exclusions")
HASH = re.compile(r"[0-9a-f]{64}")
WEAK_GLOSSES = {"a", "an", "as", "at", "be", "do", "in", "is", "it", "of", "on", "the", "to"}
TE_AUXILIARIES = {
    "居る",
    "行く",
    "来る",
    "仕舞う",
    "下さる",
    "貰う",
    "呉れる",
    "置く",
    "見る",
    "無い",
}


def cue_contexts(source, translation):
    english = {row["id"]: row["text"] for row in translation["cues"]}
    cues = source["cues"]
    lines = [[cue["japanese"], cue["reading_source"], english[cue["id"]]] for cue in cues]
    ids = source["wordIds"]
    for i, cue in enumerate(cues):
        tokens = [
            (start, end, ids[index] if index is not None else None)
            for start, end, index in cue["tokens"]
        ]
        neighbors = [
            lines[i - 1] if i else None,
            lines[i],
            lines[i + 1] if i + 1 < len(lines) else None,
        ]
        yield cue, tokens, lines[i][2], digest(encoded([neighbors, tokens]))


def word_identity(word):
    return [word.get(key) for key in ("word", "reading", "romaji", "pos")] + [
        word["meanings"].get("eng", [])
    ]


def remember(directory, source, translation, vocabulary, review, approved):
    practice = approved["practice"]
    if practice is None:
        return
    draft = review["practice"]
    targets = defaultdict(list)
    for target in draft["targets"]:
        targets[target["cue"]].append({k: v for k, v in target.items() if k != "cue"})
    base = {word["id"]: word for word in vocabulary["words"]}
    extra = {word["id"]: word for word in draft.get("supplementalWords", [])}
    meanings = draft.get("supplementalMeanings", {})
    rows = []
    for (cue, _, _, context), rendered in zip(
        cue_contexts(source, translation), practice["cues"], strict=True
    ):
        cue_id = cue["id"]
        matches = sorted(targets[cue_id], key=lambda item: item["start"])
        edits = {kind: draft.get(kind, {}).get(cue_id, []) for kind in REVIEW_FIELDS}
        used = {item["wordId"] for item in matches + edits["segments"]}
        rows.append(
            {
                "context": context,
                "reading": rendered[1:3],
                "targets": matches,
                "edits": edits,
                "dictionary": {key: word_identity(base[key]) for key in used if key in base},
                "supplementalWords": [extra[key] for key in sorted(used & extra.keys())],
                "supplementalMeanings": {key: meanings[key] for key in used & meanings.keys()},
            }
        )
    review_id = approved["reviewId"]
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    write_immutable_asset(
        directory / f"{review_id}.json",
        encoded(
            {
                "version": 1,
                "reviewId": review_id,
                "cues": rows,
            }
        ),
    )


def load_matches(directory, current_keys, text):
    contexts, surfaces = defaultdict(list), defaultdict(set)
    if directory is None or not directory.exists():
        return contexts, surfaces
    for path in sorted(directory.glob("*.json")):
        if not HASH.fullmatch(path.stem):
            continue
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * 1024 * 1024:
            raise ValueError(f"Invalid saved Practice match file {path.name}")
        document = json.loads(path.read_bytes())
        if document["version"] != 1 or document["reviewId"] != path.stem:
            raise ValueError(f"Invalid saved Practice match identity for {path.name}")
        for row in document["cues"]:
            if row["context"] in current_keys and row not in contexts[row["context"]]:
                contexts[row["context"]].append(row)
            entries = {
                word["id"]: [word[field] for field in ("word", "reading", "romaji", "pos")]
                for word in row["supplementalWords"]
            }
            entries.update({key: word[:4] for key, word in row["dictionary"].items()})
            for target in row["targets"]:
                if target["form"] not in text:
                    continue
                key = target["wordId"]
                surfaces[target["form"]].add((key, target["choices"][0], tuple(entries[key])))
    return contexts, surfaces


def reuse_match(rows, words, supplemental, meanings, cue, rendered, renderer, groups, expressions):
    if len(rows) != 1:
        return None
    [row] = rows
    if any(
        key not in words or word_identity(words[key]) != identity
        for key, identity in row["dictionary"].items()
    ):
        return None
    if any(
        item["id"] in words or supplemental.get(item["id"], item) != item
        for item in row["supplementalWords"]
    ):
        return None
    if any(
        meanings.get(key, meaning) != meaning
        for key, meaning in row["supplementalMeanings"].items()
    ):
        return None
    edits = row["edits"]["readings"]
    if edits:
        written = cue["japanese"]
        rendered = rendered or cue_readings(renderer, written, written)
        if rendered is None:
            return None
        try:
            kana, romaji, spans, _ = correct_readings(written, rendered, edits)
        except (StopIteration, ValueError):
            return None
    else:
        kana, romaji, spans = (
            (rendered[0], rendered[1], rendered[3]) if rendered else (None, None, {})
        )
    starts = {start for start, _ in spans}
    ends = {end for _, end in spans}
    if [kana, romaji] != row["reading"] or any(
        t["start"] not in starts or t["end"] not in ends for t in row["targets"]
    ):
        return None
    if groups or expressions:
        entries = words | {w["id"]: w for w in row["supplementalWords"]}
        if group_pronoun_problem(groups, row["targets"], entries, kana, romaji, spans):
            return None
        if validate_expressions(cue["japanese"], expressions, row["targets"], entries):
            return None
    return row


def playable(word):
    return word["pos"].split("/")[0] not in PRACTICE_GRAMMAR and word["meanings"].get("eng")


def indexed_spellings(words, reviewed):
    spellings = defaultdict(set)
    for key, word in words.items():
        if not playable(word):
            continue
        for surface in (word["word"], *word.get("aliases", []), *word.get("forms", [])):
            if surface and not any(char.isspace() for char in surface):
                spellings[surface].add(key)
    by_start = defaultdict(list)
    for form in spellings.keys() | reviewed.keys():
        by_start[form[0]].append(form)
    for forms in by_start.values():
        forms.sort(key=lambda form: (-len(form), form))
    return spellings, by_start


def paired_words(text):
    return (
        " "
        + " ".join(re.findall(r"[a-z0-9]+(?:['’][a-z]+)?", text.lower().replace("’", "'")))
        + " "
    )


def contextual_answers(answers, english, *, allow_plural=False):
    supported = {}
    for answer in answers:
        key = choice_key(answer)
        phrase = paired_words(key)
        words = phrase.split()
        if not words or key in WEAK_GLOSSES:
            continue
        last = words[-1]
        plural = (
            last[:-1] + "ies"
            if re.search(r"[^aeiou]y$", last)
            else last + "es"
            if last.endswith(("ch", "sh", "s", "x", "z"))
            else last + "s"
        )
        plural_phrase = " " + " ".join([*words[:-1], plural]) + " "
        if phrase in english or allow_plural and len(last) > 2 and plural_phrase in english:
            supported.setdefault(phrase, answer)
    return list(supported.values())


def inflections(written, tokens, words):
    """Return full candidate spans for a verb, adjectival predicate, or noun + suru."""
    for i, (start, end, key) in enumerate(tokens):
        word = words.get(key)
        if not word:
            continue
        pos = word["pos"].split("/")[0]
        j = i + 1
        if pos == "名詞" and j < len(tokens):
            a, b, next_key = tokens[j]
            if a == end and words.get(next_key, {}).get("word") == "為る":
                end, j = b, j + 1
        if pos not in {"動詞", "形容詞"} and j == i + 1:
            continue
        while j < len(tokens):
            a, b, next_key = tokens[j]
            next_word = words.get(next_key, {})
            continuation = next_word.get("pos", "")
            follows_te = written[end - 1 : end] in {"て", "で"} and "非自立可能" in continuation
            auxiliary = follows_te and next_word.get("word") in TE_AUXILIARIES
            if a != end or not (
                continuation.startswith("助動詞") or continuation == "助詞/接続助詞" or auxiliary
            ):
                break
            end, j = b, j + 1
        if j > i + 1:
            yield start, end, key


def cue_candidates(
    written, tokens, english, words, spellings, by_start, reviewed,
    *, groups=(), group_entries=None,
):
    bounds = {b: i for i, (_, b, _) in enumerate(tokens)}
    options = {}
    extensions = list(inflections(written, tokens, words))
    full_forms = {start: form for start, _, form in groups}
    group_spans = {(start, end) for start, end, _ in groups}
    group_english = re.sub(r"\b(we|you|they)'(?:re|ve|ll|d)\b", r"\1", english)
    for i, (start, _, original) in enumerate(tokens):
        forms = [full_forms[start]] if start in full_forms else by_start.get(written[start], [])
        for form in forms:
            end = start + len(form)
            if end not in bounds or not written.startswith(form, start):
                continue
            group = group_identity(form) if (start, end) in group_spans else None
            segment = tokens[i : bounds[end] + 1]
            # Detected pronouns may span tokens with missing dictionary IDs.
            if group or (original is not None and all(key is not None for _, _, key in segment)):
                keys = group_entries.get(group, ()) if group else spellings.get(form, ())
                for key in sorted(keys):
                    identity = word_identity(words[key])
                    answers = identity[-1]
                    if group:
                        answers = [answer for answer in answers if not singular_answer(answer)]
                    guesses = contextual_answers(
                        answers,
                        group_english if group else english,
                        allow_plural=not group and identity[3].startswith("名詞"),
                    )
                    options[start, end, key] = (form, identity[:4], guesses, "dictionary")
            for key, answer, identity in sorted(reviewed.get(form, ())):
                if group and (group_identity(identity[0]) != group or singular_answer(answer)):
                    continue
                current = words.get(key)
                if current and tuple(word_identity(current)[:4]) != identity:
                    continue
                guesses = contextual_answers([answer], group_english if group else english)
                candidate = options.get((start, end, key))
                if guesses or not candidate:
                    answers = sorted(
                        set(guesses)
                        | set(candidate[2] if candidate and candidate[3] == "reviewed" else [])
                    )
                    options[start, end, key] = (form, identity, answers, "reviewed")
    for start, end, key in extensions:
        options.setdefault(
            (start, end, key), (written[start:end], word_identity(words[key])[:4], [], "inflection")
        )

    candidates = []
    for (start, end, key), (form, identity, answers, basis) in options.items():
        if (start, end) not in group_spans and any(start < b and a < end for a, b, _ in groups):
            continue
        word, reading, _, pos = identity
        prior_answers = sorted(
            {answer for entry, answer, _ in reviewed.get(form, ())
             if entry == key and ((start, end) not in group_spans or not singular_answer(answer))}
        )
        inflection_part = any(
            a <= start < end <= b and (start, end) != (a, b) for a, b, _ in extensions
        )
        candidates.append(
            {
                "start": start,
                "end": end,
                "form": form,
                "wordId": key,
                "word": word,
                "reading": reading,
                "pos": pos,
                "answers": answers,
                "basis": basis,
                **({"reviewedAnswers": prior_answers} if prior_answers else {}),
                **({"partOfInflection": True} if inflection_part else {}),
            }
        )
    return sorted(
        candidates,
        key=lambda c: (
            c["start"],
            -(c["end"] - c["start"]),
            not c["answers"],
            c["wordId"],
        ),
    )


def preferred_matches(candidates):
    """Favor longer context-supported spans and leave ambiguous peers unresolved."""
    by_span = defaultdict(list)
    for candidate in candidates:
        if candidate["answers"] and not candidate.get("partOfInflection"):
            by_span[candidate["start"], candidate["end"]].append(candidate)
    chosen = []
    for (start, end), peers in sorted(
        by_span.items(),
        key=lambda row: (
            -(row[0][1] - row[0][0]),
            row[0][0],
        ),
    ):
        if len(peers) != 1 or len(peers[0]["answers"]) != 1:
            continue
        if any(start < row["end"] and row["start"] < end for row in chosen):
            continue
        chosen.append(peers[0])
    return sorted(chosen, key=lambda row: row["start"])


def expression_candidates(written, spans, candidates, renderer, rendered, english):
    """Prefer verified whole expressions over candidates inside their spans."""
    anchors = {(start, end): rule for start, end, rule in spans}
    retained = []
    for candidate in candidates:
        start, end = candidate["start"], candidate["end"]
        rule = anchors.get((start, end))
        if rule is not None:
            if rule.accepts(candidate):
                retained.append(candidate)
        elif not any(start < b and a < end for a, b in anchors):
            retained.append(candidate)

    for start, end, rule in spans:
        existing = [c for c in retained if (c["start"], c["end"]) == (start, end)]
        if existing:
            continue
        reading = None
        if rendered:
            starts = {a: span[0] for (a, _), span in rendered[3].items()}
            ends = {b: span[1] for (_, b), span in rendered[3].items()}
            if start in starts and end in ends:
                reading = rendered[0][starts[start]:ends[end]]
        word = rule.candidate(reading, renderer.romanizer.romaji)
        retained.append({
            "start": start, "end": end, "form": written[start:end], "wordId": word["id"],
            "word": word["word"], "reading": word["reading"], "pos": word["pos"],
            "answers": contextual_answers(rule.glosses, paired_words(english)),
            "basis": "expression",
            "jmdictEntryId": rule.entry, "suggestedWord": word,
            "suggestedMeanings": list(rule.glosses),
        })
    return sorted(retained, key=lambda c: (c["start"], -c["end"], not c["answers"], c["wordId"]))


def draft_matches(source, translation, vocabulary, review, directory):
    """Return suggestions and prefill only exact matches with compatible dictionary data."""
    words = {word["id"]: word for word in vocabulary["words"]}
    cue_data = list(cue_contexts(source, translation))
    contexts, reviewed = load_matches(
        directory,
        {key for _, _, _, key in cue_data},
        "\n".join(cue["japanese"] for cue in source["cues"]),
    )
    spellings, by_start = indexed_spellings(words, reviewed)
    group_entries = defaultdict(list)
    for word_id, word in words.items():
        if (identity := group_identity(word.get("word", ""))) and playable(word):
            group_entries[identity].append(word_id)
    renderer = JapaneseRenderer()
    suggestions = {}
    supplemental = {}
    meanings = {}
    reused = []
    for cue, tokens, english, key in cue_data:
        cue_id = cue["id"]
        written = cue["japanese"]
        rendered = cue_readings(renderer, written, cue["reading_source"])
        groups = list(group_pronouns(written, tokens, words))
        expressions = expression_spans(written, tokens)
        exact = reuse_match(
            contexts.get(key, []), words, supplemental, meanings, cue, rendered, renderer, groups,
            expressions,
        )
        if exact:
            reused.append(cue_id)
            review["targets"].extend({"cue": cue_id, **target} for target in exact["targets"])
            for field, edits in exact["edits"].items():
                if edits:
                    review.setdefault(field, {})[cue_id] = edits
            supplemental.update((word["id"], word) for word in exact["supplementalWords"])
            meanings.update(exact["supplementalMeanings"])
            continue
        candidates = cue_candidates(
            written, tokens, paired_words(english), words, spellings, by_start, reviewed,
            groups=groups, group_entries=group_entries,
        )
        if expressions:
            candidates = expression_candidates(
                written, expressions, candidates, renderer, rendered, english,
            )
        group_spans = {(start, end) for start, end, _ in groups}
        aligned = []
        if rendered:
            starts = {start: span for (start, _), span in rendered[3].items()}
            ends = {end: span for (_, end), span in rendered[3].items()}
            for item in candidates:
                start, end = starts.get(item["start"]), ends.get(item["end"])
                if start and end and start[2] < end[3]:
                    item.update(
                        kana=rendered[0][start[0] : end[1]], romaji=rendered[1][start[2] : end[3]]
                    )
                    if (
                        (item["start"], item["end"]) not in group_spans
                        or group_entry(item["form"], item["kana"], item)
                    ):
                        aligned.append(item)
        suggestions[cue_id] = {"preferred": preferred_matches(aligned), "candidates": candidates}
        if expressions:
            suggestions[cue_id]["wholeExpressions"] = [
                {"start": a, "end": b, "form": written[a:b], "jmdictEntryId": rule.entry}
                for a, b, rule in expressions
            ]
        if groups:
            suggestions[cue_id]["groupPronouns"] = [
                {"start": start, "end": end, "form": form,
                 "candidateWordIds": sorted({c["wordId"] for c in candidates
                                             if (c["start"], c["end"]) == (start, end)})}
                for start, end, form in groups
            ]
    if supplemental:
        review["supplementalWords"] = list(supplemental.values())
    if meanings:
        review["supplementalMeanings"] = meanings
    available = words | {
        key: {**item, "meanings": {"eng": [meanings[key]]}}
        for key, item in supplemental.items() if key in meanings
    }
    return {"version": 1, "reusedCues": reused, "cues": suggestions,
            "masteryConflicts": list(duplicate_credits(available))}
