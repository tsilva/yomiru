"""Verified whole expressions and equivalent mastery entries for episode review."""

import re
from collections import defaultdict
from dataclasses import dataclass
from itertools import combinations

from jaconv import kata2hira

from yomiru.practice_context import gloss_key
from yomiru.vocabulary import digest


@dataclass(frozen=True)
class Expression:
    entry: int
    headword: str
    readings: tuple
    pos: str
    glosses: tuple
    pattern: re.Pattern
    aliases: tuple = ()
    match_pos: bool = False

    def accepts(self, word):
        return (
            word["word"] in (self.headword, *self.aliases) and word["reading"] in self.readings
            and (not self.match_pos or word["pos"].split("/")[0] == self.pos)
        )

    def candidate(self, reading, romanize):
        reading = reading if reading in self.readings else self.readings[0]
        return {
            "id": "ja-" + digest(["jmdict", self.entry, reading]), "word": self.headword,
            "reading": reading, "romaji": romanize(reading), "pos": self.pos, "registry": True,
        }


def expression(entry, word, reading, pos, glosses, surfaces, *aliases, match_pos=False):
    return Expression(
        entry, word, tuple(reading.split("|")), pos, glosses, re.compile(surfaces),
        aliases, match_pos,
    )


# JMdict entries verified against the release dictionary. Patterns describe
# written variants and inflections whose contextual answer belongs to the unit.
EXPRESSIONS = (
    expression(1005900, "じゃあ", "じゃあ", "接続詞", ("then", "well then", "so"),
               r"(?:じゃあ(?![ねな])|^んじゃ(?!ない))", "じゃ"),
    expression(1008850, "と言えば", "といえば", "連語", ("speaking of", "when it comes to"),
               r"と(?:言|い)えば", "といえば"),
    expression(2206220, "と言うか", "というか", "接続詞", ("or rather", "I mean", "actually"),
               r"と(?:言う|いう|ゆう)か", "というか"),
    expression(2136030, "と言うと", "というと", "連語", ("you mean", "which is"),
               r"と(?:言う|いう|ゆう)と", "というと"),
    expression(1264350, "言うまでもない", "いうまでもない|ゆうまでもない", "連語",
               ("needless to say", "goes without saying"),
               r"(?:言う|いう|ゆう)(?:まで|迄)も(?:なかった|無かった|なく(?:て)?|無く(?:て)?|ない|無い)"),
    expression(2838528, "何と言うか", "なんというか", "連語", ("how should I put it",),
               r"(?:なんと|何と|なんて)(?:言う|いう|ゆう)か", "何というか", "なんというか"),
    expression(2249850, "言われてみれば", "いわれてみれば", "連語", ("now that you mention it",),
               r"(?:言|い)われてみれば"),
    expression(1188270, "何か", "なにか|なんか", "代名詞", ("something", "anything", "some", "any"),
               r"(?:何|なに)か(?!しら|と)", "なにか", "なんか", match_pos=True),
    expression(1346200, "勝手に", "かってに", "副詞", ("without asking", "as one pleases"),
               r"(?:勝手|かって)に"),
    expression(1725390, "このまま", "このまま", "連語", ("as it is", "at this rate", "like this"),
               r"(?:この|此の)(?:まま|儘)", "此の儘", "この儘"),
    expression(1632160, "となると", "となると", "連語", ("when it comes to", "in that case"),
               r"と(?:なる|成る)と"),
    expression(2089660, "どうしよう", "どうしよう", "連語", ("what should I do", "what to do"),
               r"どうしよう(?!も)", "どうしょう"),
    expression(2841446, "に決まっている", "にきまっている", "連語", ("obviously", "certainly"),
               r"に\s*(?:決|き)まっ(?:ている|てる|とろう)", "に決っている"),
    expression(2834510, "いやん", "いやん|いやーん|いやあん", "感動詞", ("oh my", "oh no"),
               r"(?:いや|イヤ)[~〜～ーあア]?ん|イヤ[~〜～ーア]?ン", "いやーん", "いやあん"),
    expression(1594120, "仕方なく", "しかたなく", "副詞", ("reluctantly", "as a last resort"),
               r"(?:仕方|しかた)(?:なく|無く)", "仕方無く", "しかたなく"),
    expression(1305440, "仕方ない", "しかたない", "形容詞", ("can't be helped", "cannot be helped"),
               r"(?:仕方|しかた)(?:ない|無い)", "仕方無い", "しかたない"),
)

SUFFICIENT_GLOSSES = {"enough", "sufficient", "sufficiently", "fully", "adequate", "plenty"}


def expression_spans(written, tokens):
    starts = {start for start, _, _ in tokens}
    ends = {end for _, end, _ in tokens}
    possible = [
        (match.start(), match.end(), rule)
        for rule in EXPRESSIONS
        for match in rule.pattern.finditer(written)
        if match.start() in starts and match.end() in ends
    ]
    found = []
    for start, end, rule in sorted(possible, key=lambda s: (-(s[1] - s[0]), s[0])):
        if not any(start < b and a < end for a, b, _ in found):
            found.append((start, end, rule))
    return sorted(found, key=lambda s: s[0])


def validate_expressions(written, spans, targets, words, exceptions=()):
    anchors = {(a, b) for a, b, _ in spans}
    waived = set()
    for item in exceptions:
        start, end = item["start"], item["end"]
        if ((start, end) not in anchors or (start, end) in waived
                or item["form"] != written[start:end] or not item["reason"].strip()):
            return "Invalid or stale whole-expression exception"
        waived.add((start, end))
    by_span = {(target["start"], target["end"]): target for target in targets}
    for start, end, rule in spans:
        if (start, end) in waived:
            continue
        target = by_span.get((start, end))
        form = written[start:end]
        if not target:
            return f"Highlight the whole expression {form} at {start}:{end}"
        if not rule.accepts(words[target["wordId"]]):
            return f"Credit {form} at {start}:{end} to its full entry {rule.headword}"
    return None


def duplicate_credits(words, answers=None):
    """Find duplicate IDs with form, reading, and sense evidence."""
    by_reading = defaultdict(list)
    for key, word in words.items():
        if word.get("reading") and word.get("word"):
            by_reading[kata2hira(word["reading"])].append(key)
    for reading, ids in by_reading.items():
        for left, right in combinations(ids, 2):
            a, b = words[left], words[right]
            a_gloss = {gloss_key(g) for g in a.get("meanings", {}).get("eng", [])}
            b_gloss = {gloss_key(g) for g in b.get("meanings", {}).get("eng", [])}
            same_rule = any(rule.accepts(a) and rule.accepts(b) for rule in EXPRESSIONS)
            # These are compatible senses of JMdict 1335080 even if POS-scoped
            # dictionary rows have no verbatim English gloss in common.
            a_evidence = a_gloss if answers is None else answers[left]
            b_evidence = b_gloss if answers is None else answers[right]
            sufficient = (
                reading == "じゅうぶん" and {a["word"], b["word"]} <= {"十分", "充分"}
                and bool(a_evidence & SUFFICIENT_GLOSSES) and bool(b_evidence & SUFFICIENT_GLOSSES)
            )
            same_pos = a["pos"].split("/")[0] == b["pos"].split("/")[0]
            equivalent_form = (
                a["word"] == b["word"] or a["word"] in b.get("aliases", ())
                or b["word"] in a.get("aliases", ())
            )
            same_gloss = bool(a_gloss & b_gloss) and (
                answers is None or a_gloss == b_gloss or bool(answers[left] & answers[right])
            )
            if same_rule or sufficient or (same_pos and equivalent_form and same_gloss):
                yield {"wordIds": sorted([left, right]), "headwords": [a["word"], b["word"]],
                       "reading": reading}
