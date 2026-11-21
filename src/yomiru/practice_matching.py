"""Suggest contextual Practice matches and reuse validated private reviews."""

import json
import re
from collections import defaultdict

from yomiru.japanese import JapaneseRenderer
from yomiru.practice_context import PRACTICE_GRAMMAR, cue_readings
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


def reuse_match(rows, words, supplemental, meanings, cue, rendered, renderer):
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
    return row


def indexed_spellings(words, reviewed):
    spellings = defaultdict(set)
    for key, word in words.items():
        if word["pos"].split("/")[0] in PRACTICE_GRAMMAR or not word["meanings"].get("eng"):
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


def cue_candidates(written, tokens, english, words, spellings, by_start, reviewed):
    bounds = {b: i for i, (_, b, _) in enumerate(tokens)}
    options = {}
    extensions = list(inflections(written, tokens, words))
    for i, (start, _, original) in enumerate(tokens):
        for form in by_start.get(written[start], []):
            end = start + len(form)
            if end not in bounds or not written.startswith(form, start):
                continue
            segment = tokens[i : bounds[end] + 1]
            # Source exclusions can be reconsidered only using a reviewed match.
            if original is not None and all(key is not None for _, _, key in segment):
                for key in sorted(spellings.get(form, set())):
                    identity = word_identity(words[key])
                    guesses = contextual_answers(
                        identity[-1], english, allow_plural=identity[3].startswith("名詞")
                    )
                    options[start, end, key] = (form, identity[:4], guesses, "dictionary")
            for key, answer, identity in sorted(reviewed.get(form, ())):
                current = words.get(key)
                if current and tuple(word_identity(current)[:4]) != identity:
                    continue
                guesses = contextual_answers([answer], english)
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
        word, reading, _, pos = identity
        prior_answers = sorted(
            {answer for entry, answer, _ in reviewed.get(form, ()) if entry == key}
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
    renderer = JapaneseRenderer()
    suggestions = {}
    supplemental = {}
    meanings = {}
    reused = []
    for cue, tokens, english, key in cue_data:
        cue_id = cue["id"]
        written = cue["japanese"]
        rendered = cue_readings(renderer, written, cue["reading_source"])
        exact = reuse_match(
            contexts.get(key, []), words, supplemental, meanings, cue, rendered, renderer
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
            written, tokens, paired_words(english), words, spellings, by_start, reviewed
        )
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
                    aligned.append(item)
        suggestions[cue_id] = {"preferred": preferred_matches(aligned), "candidates": candidates}
    if supplemental:
        review["supplementalWords"] = list(supplemental.values())
    if meanings:
        review["supplementalMeanings"] = meanings
    return {"version": 1, "reusedCues": reused, "cues": suggestions}
