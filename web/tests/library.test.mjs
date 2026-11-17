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
  assert.match(subtitle.label, /timing unverified/);
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

test("groups paired learning tracks under Japanese with romaji first without changing publication data", () => {
  const scripts = ["japanese", "katakana", "hiragana", "romaji"];
  const publication = { version: 1, tracks: scripts.map((script, i) => ({
    ...track, script, id: String(i + 1).repeat(64),
  })) };
  const before = structuredClone(publication);
  const result = subtitles(publication, "series", "tt1234567:1:1");
  assert.deepEqual(result.map(t => t.lang), ["jpn", "jpn", "jpn", "jpn"]);
  assert.deepEqual(result.map(t => t.label.split(" · ")[0]),
    ["🦊 Romaji", "🦊 Hiragana", "🦊 Katakana", "🦊 Japanese"]);
  assert.ok(result.every(t => t.label.includes("Synthetic source") && t.label.endsWith("timing unverified")));
  assert.deepEqual(publication, before);
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
