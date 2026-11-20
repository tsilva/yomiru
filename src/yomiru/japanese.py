"""Preserve source spelling separately from pronunciation-based display modes."""

import re
import unicodedata
from enum import StrEnum

import cutlet
import jaconv


class Script(StrEnum):
    ROMAJI = "romaji"
    KANA = "kana"
    JAPANESE = "japanese"


RUBY = re.compile(r"([一-龯々]+)[（(]([ぁ-ゖァ-ヺー]+)[）)]")
PARENTHESES = re.compile(r"[（(][^）)]*[）)]")
KANJI = re.compile(r"[々〆〇〻㐀-䶿一-鿿豈-﫿\U00020000-\U0003FFFF]+")
KANA_RUN = re.compile(r"([ぁ-ゖゝゞァ-ヺヽヾー]+)")
KATAKANA = re.compile(r"[ァ-ヺヽヾ]")


def source_forms(text: str) -> tuple[str, str]:
    written = RUBY.sub(r"\1", text)
    reading = RUBY.sub(r"\2", text)

    def clean(value: str) -> str:
        value = PARENTHESES.sub("", value)
        value = unicodedata.normalize("NFKC", value)
        return re.sub(r"\s+", " ", value).strip()

    return clean(written), clean(reading)


def mixed_kana(surface: str, reading: str | None) -> str:
    if not reading or not KANJI.search(surface):
        return surface
    hiragana = jaconv.kata2hira(reading)
    if not KATAKANA.search(surface):
        return hiragana

    # Align the written kana within the dictionary reading of a mixed token.
    parts = KANA_RUN.split(surface)
    pattern = "".join(re.escape(jaconv.kata2hira(part)) if index % 2 else "(.+?)" if part else ""
                      for index, part in enumerate(parts))
    if match := re.fullmatch(pattern, hiragana):
        gaps = iter(match.groups())
        return "".join(part if index % 2 or not part else next(gaps)
                       for index, part in enumerate(parts))
    return hiragana


class JapaneseRenderer:
    def __init__(self):
        self.romanizer = cutlet.Cutlet(use_foreign_spelling=False, ensure_ascii=False)
        self.romanizer.use_wo = False

    def render(self, text: str, script: Script) -> str:
        written, reading = source_forms(text)
        if script == Script.JAPANESE:
            return written
        if script == Script.ROMAJI:
            return KANJI.sub("□", self.romanizer.romaji(reading))
        tokens = self.romanizer.tagger(reading)
        kana = "".join(mixed_kana(token.surface, token.feature.kana) for token in tokens)
        return KANJI.sub("□", kana)
