import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { subtitles, validateAsset, validateIndex } from "../lib/library.mjs";
import handler from "../api/subtitles.mjs";

const bytes = Buffer.from("[Script Info]\n; original synthetic fixture\n");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const track = {
  id: "1".repeat(64), videoIds: ["tt1234567:1:1"], type: "series", lang: "eng",
  script: "romaji", sha256, path: `/library/${sha256}.ass`, bytes: bytes.length,
  cues: 1, source: { label: "Synthetic source", url: "https://example.test/captions" },
};
const index = { version: 1, tracks: [track] };

test("matches exact episode and media type with public HTTPS ASS URLs", () => {
  validateIndex(index);
  validateAsset(track, bytes);
  assert.equal(subtitles(index, "series", "tt1234567:1:1").length, 1);
  assert.deepEqual(subtitles(index, "series", "tt1234567:1:2"), []);
  assert.deepEqual(subtitles(index, "movie", "tt1234567:1:1"), []);
  const subtitle = subtitles(index, "series", "tt1234567:1:1")[0];
  assert.match(subtitle.url, /^https:\/\/yomiru\.tsilva\.eu\/library\/[a-f0-9]{64}\.ass$/);
  assert.equal(subtitle.label, "🦊 Romaji");
});

test("rejects tampered assets, foreign paths, duplicate IDs and invalid modes", () => {
  assert.throws(() => validateAsset(track, Buffer.from("changed")));
  for (const changed of [
    { ...track, path: "https://elsewhere.test/sub.ass" },
    { ...track, script: "invalid" },
    { ...track, source: { label: "Source", url: "https://user:secret@example.test/" } },
  ]) assert.throws(() => validateIndex({ version: 1, tracks: [changed] }));
  assert.throws(() => validateIndex({ version: 1, tracks: [track, track] }));
});

test("tags paired tracks by translation language and keeps the fox and reading-mode order", () => {
  const scripts = ["japanese", "katakana", "hiragana", "romaji"];
  const publication = { version: 1, tracks: scripts.flatMap((script, i) => [
    { ...track, script, lang: "eng", id: String(i + 1).repeat(64) },
    { ...track, script, lang: "por", id: String(i + 5).repeat(64) },
  ]) };
  const before = structuredClone(publication);
  const result = subtitles(publication, "series", "tt1234567:1:1");
  assert.deepEqual(result.map(t => [t.lang, t.label]), [
    ["eng", "🦊 Romaji"], ["por", "🦊 Romaji"],
    ["eng", "🦊 Hiragana"], ["por", "🦊 Hiragana"],
    ["eng", "🦊 Katakana"], ["por", "🦊 Katakana"],
    ["eng", "🦊 Japanese"], ["por", "🦊 Japanese"],
  ]);
  assert.deepEqual(publication, before);
});

test("prefers the anchored version of a reading mode and keeps legacy-only coverage", () => {
  const otherLanguage = { ...track, id: "2".repeat(64), lang: "por" };
  const legacyMode = { ...track, id: "3".repeat(64), script: "hiragana" };
  const replacement = { ...track, id: "4".repeat(64), anchor: "a".repeat(64) };
  const otherEpisode = { ...replacement, id: "5".repeat(64), videoIds: ["tt1234567:1:2"] };
  const publication = { version: 1, tracks: [track, otherLanguage, legacyMode, replacement, otherEpisode] };
  assert.deepEqual(subtitles(publication, "series", "tt1234567:1:1").map(t => t.id),
    [otherLanguage.id, replacement.id, legacyMode.id]);
  assert.deepEqual(subtitles({ version: 1, tracks: [track, otherEpisode] }, "series", "tt1234567:1:1").map(t => t.id),
    [track.id]);
});

test("public endpoint rejects writes and supports preflight without reading library", () => {
  for (const [method, expected] of [["POST", 405], ["OPTIONS", 204]]) {
    const result = { headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.code = code; return this; }, end() {}, json(body) { this.body = body; } };
    handler({ method, query: {} }, result);
    assert.equal(result.code, expected);
    assert.equal(result.headers["Access-Control-Allow-Origin"], "*");
  }
});
