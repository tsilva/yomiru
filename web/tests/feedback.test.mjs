import assert from "node:assert/strict";
import test from "node:test";
import { renderPlaybackTrack } from "../lib/playback-ass.mjs";
import retired from "../api/retired-subtitles.mjs";

const syntheticAss = `[Script Info]
PlayResX: 1440
PlayResY: 1080
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,20,20,40,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:10.00,0:00:12.00,Default,,0,0,0,,Original synthetic text.
`;

test("playback conversion preserves dialogue, timing, styling and existing positions", () => {
  const learning = "Dialogue: 0,0:00:10.00,0:00:12.00,Japanese,,0,0,0,,Koko de, yasumou.";
  const translation = "Dialogue: 0,0:00:10.20,0:00:12.00,English,,0,0,0,,{\\fs28}Let's rest,\\Nright here.";
  const positioned = "Dialogue: 0,0:00:12.00,0:00:14.00,English,,0,0,0,,{\\pos(100,100)}Keep this position.";
  const englishStyle = "Style: English,Arial,42,&H00FFE6A8,&H000000FF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,2.5,1,8,83,83";
  const japaneseStyle = "Style: Japanese,Arial,58,&H00B5EAFF,&H000000FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,83,83";
  for (const [width, height, bottomMargin, topMargin, learningY] of [
    [1440, 1080, 184, 900, 896],
    [1280, 720, 122, 601, 598],
  ]) {
    const ass = syntheticAss.replace("PlayResX: 1440", `PlayResX: ${width}`).replace("PlayResY: 1080", `PlayResY: ${height}`)
      .replace("[Events]", `${japaneseStyle},${bottomMargin},1\n${englishStyle},${topMargin},1\n[Events]`)
      + [learning, translation, positioned, ""].join("\n");
    const bytes = renderPlaybackTrack(Buffer.from(ass));
    assert.deepEqual(renderPlaybackTrack(bytes), bytes);
    const output = bytes.toString().split("\n");
    assert.equal(output.filter(line => line.startsWith("Dialogue:")).length, 4);
    assert(output.includes(learning.replace(",,Koko", `,,{\\pos(${width / 2},${learningY})}Koko`)));
    assert(output.includes(translation.replace(",,{", `,,{\\pos(${width / 2},${topMargin})}{`)));
    assert(output.includes(positioned));
    assert(output.includes(`${japaneseStyle},${bottomMargin},1`));
    assert(output.includes(`${englishStyle},${topMargin},1`));
  }
});


test("retired playback and feedback URLs return an uncached gone response", () => {
  const result = { headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; }, end() {} };
  retired({}, result);
  assert.equal(result.code, 410);
  assert.equal(result.headers["Cache-Control"], "no-store");
});
