"""Preserve source spelling separately from pronunciation-based display modes."""

import re
import unicodedata
from enum import StrEnum

import cutlet
import jaconv


class Script(StrEnum):
    ROMAJI = "romaji"
    HIRAGANA = "hiragana"
    KATAKANA = "katakana"
    JAPANESE = "japanese"


RUBY = re.compile(r"([一-龯々]+)[（(]([ぁ-ゖァ-ヺー]+)[）)]")
PARENTHESES = re.compile(r"[（(][^）)]*[）)]")


def source_forms(text: str) -> tuple[str, str]:
    written = RUBY.sub(r"\1", text)
    reading = RUBY.sub(r"\2", text)

    def clean(value: str) -> str:
        value = PARENTHESES.sub("", value)
        value = unicodedata.normalize("NFKC", value)
        return re.sub(r"\s+", " ", value).strip()

    return clean(written), clean(reading)


class JapaneseRenderer:
    def __init__(self):
        self.romanizer = cutlet.Cutlet(use_foreign_spelling=False, ensure_ascii=False)
        self.romanizer.use_wo = False

    def render(self, text: str, script: Script) -> str:
        written, reading = source_forms(text)
        if script == Script.JAPANESE:
            return written
        if script == Script.ROMAJI:
            return self.romanizer.romaji(reading)
        tokens = self.romanizer.tagger(reading)
        kana = "".join(token.feature.kana or token.surface for token in tokens)
        return jaconv.kata2hira(kana) if script == Script.HIRAGANA else jaconv.hira2kata(kana)
