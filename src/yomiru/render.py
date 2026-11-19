"""Generate separate ASS language styles while preserving both source timelines."""

import re
import unicodedata
from dataclasses import dataclass

from yomiru.captions import Cue, coalesce
from yomiru.japanese import JapaneseRenderer, Script


@dataclass(frozen=True)
class Appearance:
    width: int = 1440
    height: int = 1080
    japanese_colour: str = "#FFEAB5"
    english_colour: str = "#A8E6FF"

    def __post_init__(self):
        if not (320 <= self.width <= 7680 and 240 <= self.height <= 4320):
            raise ValueError("Unsupported subtitle canvas dimensions")
        for colour in (self.japanese_colour, self.english_colour):
            if not re.fullmatch(r"#[0-9A-Fa-f]{6}", colour):
                raise ValueError("Colours must use #RRGGBB")


def ass_colour(colour: str) -> str:
    return f"&H00{colour[5:7]}{colour[3:5]}{colour[1:3]}".upper()


def timestamp(ms: int) -> str:
    cs = (ms + 5) // 10
    return f"{cs // 360000}:{cs // 6000 % 60:02}:{cs // 100 % 60:02}.{cs % 100:02}"


def language_margins(height: int) -> tuple[int, int]:
    """Anchor Japanese upward and English downward around a compact shared gap."""
    japanese_bottom = round(height * 0.17)
    english_top = height - japanese_bottom + max(2, round(height * 0.004))
    return japanese_bottom, english_top


def wrap_text(text: str, columns: int) -> list[str]:
    """Conservatively wrap wide Japanese glyphs as well as Latin words."""
    lines, current = [], ""

    def length(value):
        return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in value)

    for word in text.split():
        if current and length(current + " " + word) > columns:
            lines.append(current)
            current = ""
        for char in word:
            if length(current + char) > columns:
                lines.append(current)
                current = ""
            current += char
        current += " "
    if current.strip():
        lines.append(current.strip())
    return [line.strip() for line in lines]


def render_ass(
    japanese: list[Cue],
    english: list[Cue],
    script: Script,
    appearance: Appearance,
    *,
    base_label: str | None = "English",
) -> str:
    renderer = JapaneseRenderer()
    learning = [Cue(c.start, c.end, renderer.render(c.text, script)) for c in japanese]
    learning = [cue for cue in learning if cue.text]
    height, width = appearance.height, appearance.width
    main_size, english_size = round(height * 0.054), round(height * 0.039)
    japanese_bottom, english_top = language_margins(height)
    margin = round(width * 0.065)
    font = "Arial" if script == Script.ROMAJI else "sans-serif"
    style_format = (
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"
    )
    japanese_style = (
        f"Style: Japanese,{font},{main_size},{ass_colour(appearance.japanese_colour)},"
        "&H000000FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,"
        f"{margin},{margin},{japanese_bottom},1"
    )
    english_style = (
        f"Style: English,Arial,{english_size},{ass_colour(appearance.english_colour)},"
        "&H000000FF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,2.5,1,8,"
        f"{margin},{margin},{english_top},1"
    )
    title = script.value
    styles = japanese_style
    timelines = [("Japanese", learning, main_size)]
    if base_label is not None:
        title += f" + {base_label}"
        styles += f"\n{english_style}"
        timelines.append(("English", english, english_size))
    header = f"""[Script Info]
Title: Yomiru - {title}
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
{style_format}
{styles}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    for style, cues, size in timelines:
        columns = max(10, int((width - 2 * margin) / (size * 0.62)))
        for cue in coalesce(cues):
            # Braces and backslashes are executable formatting in ASS dialogue.
            safe = cue.text.replace("{", "〔").replace("}", "〕").replace("\\", "/")
            lines = wrap_text(safe, columns)
            text = r"\N".join(lines)
            # Keep unusually long captions within their vertical language region.
            if len(lines) > 3:
                text = f"{{\\fs{max(12, round(size * 3 / len(lines)))}}}" + text
            if timestamp(cue.start) == timestamp(cue.end):
                continue
            event = (
                f"Dialogue: 0,{timestamp(cue.start)},{timestamp(cue.end)},{style},,0,0,0,,{text}"
            )
            events.append((cue.start, style, event))
    return header + "\n".join(event for _, _, event in sorted(events)) + "\n"
