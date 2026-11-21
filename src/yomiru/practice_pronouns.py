"""Find and validate whole group pronouns in contextual Practice."""

import re

from jaconv import kata2hira

STEM_SPELLINGS = (
    ("俺", "おれ", "己"),
    ("僕", "ぼく"),
    ("私", "わたし", "わたくし", "あたし", "あたくし"),
    ("わし", "儂"),
    ("我", "われ"),
    ("うち", "内"),
    ("自分", "じぶん"),
    ("君", "きみ"),
    ("あなた", "あんた", "貴方", "貴女"),
    ("お前", "御前", "おまえ"),
    ("貴様", "きさま"),
    ("てめえ", "手前"),
    ("彼", "かれ"),
    ("彼女", "かのじょ"),
    ("あいつ", "彼奴"),
    ("こいつ", "此奴"),
    ("そいつ", "其奴"),
    ("どいつ", "何奴"),
)
STEM = {spelling: forms[0] for forms in STEM_SPELLINGS for spelling in forms}
SUFFIX = {"たち": "たち", "達": "たち", "ら": "ら", "等": "ら"}
STEM_PATTERN = "|".join(map(re.escape, sorted(STEM, key=lambda form: (-len(form), form))))
GROUP = re.compile(f"({STEM_PATTERN})({'|'.join(SUFFIX)})")
ENDING = re.compile(f"(.+?)({'|'.join(SUFFIX)})")
SINGULAR_ANSWERS = {
    "i", "me", "myself", "he", "him", "himself", "she", "her", "herself",
    "this guy", "that guy", "this person", "that person",
}


def group_identity(form):
    match = ENDING.fullmatch(kata2hira(form))
    return (STEM.get(match[1], match[1]), SUFFIX[match[2]]) if match else None


def group_pronouns(written, tokens, words):
    """Use the archived boundaries to keep adjectival らしい outside this rule."""
    tokens = list(tokens)
    ends = {end for _, end, _ in tokens}
    kana_spelling = kata2hira(written)
    for i, (start, end, key) in enumerate(tokens):
        pos = words.get(key, {}).get("pos", "").split("/")[0]
        match = GROUP.match(kana_spelling, start)
        if match and match.end() in ends:
            # After a name, 君【くん】 is an honorific.
            if match[1] == "君" and pos == "接尾辞" and start and written[start - 1].isalnum():
                continue
            yield start, match.end(), written[start:match.end()]
        elif pos == "代名詞" and i + 1 < len(tokens):
            suffix_start, suffix_end, _ = tokens[i + 1]
            if end == suffix_start and kana_spelling[suffix_start:suffix_end] in SUFFIX:
                yield start, suffix_end, written[start:suffix_end]


def group_entry(form, kana, word):
    identity = group_identity(form)
    reading = kata2hira(kana) if kana else ""
    return bool(
        identity and word and group_identity(word["word"]) == identity
        and reading.endswith(identity[1]) and kata2hira(word["reading"]) == reading
    )


def singular_answer(answer):
    return re.sub(r"\s*\([^)]*\)", "", answer).strip().lower().rstrip(".?!") in SINGULAR_ANSWERS


def group_pronoun_problem(groups, targets, words, kana, romaji, spans):
    if not groups:
        return None
    by_span = {(target["start"], target["end"]): target for target in targets}
    starts = {start: (span[0], span[2]) for (start, _), span in spans.items()}
    ends = {end: (span[1], span[3]) for (_, end), span in spans.items()}
    for start, end, form in groups:
        target = by_span.get((start, end))
        if not target or start not in starts or end not in ends:
            return f"Highlight the whole group pronoun {form} at {start}:{end}"
        hs, rs = starts[start]
        he, re_ = ends[end]
        if not group_entry(form, kana[hs:he], words.get(target["wordId"])):
            return f"Credit {form} at {start}:{end} to its full entry with the matching reading"
        suffix = "tachi" if group_identity(form)[1] == "たち" else "ra"
        if not romaji[rs:re_].lower().endswith(suffix):
            return f"Include the {suffix} ending in the rōmaji for {form} at {start}:{end}"
        if singular_answer(target["choices"][0]):
            return f"Use a group meaning for {form} at {start}:{end}"
    return None
