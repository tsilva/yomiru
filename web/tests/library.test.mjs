import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { subtitles, validateAsset, validateIndex } from "../lib/library.mjs";
import handler from "../api/subtitles.mjs";
import { createHandler as subtitleDiscovery } from "../api/subtitles.mjs";
import { createHandler as libraryDownload } from "../api/library.mjs";

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
    { ...track, superseded: "true" },
    { ...track, source: { label: "Source", url: "https://user:secret@example.test/" } },
  ]) assert.throws(() => validateIndex({ version: 1, tracks: [changed] }));
  assert.throws(() => validateIndex({ version: 1, tracks: [track, track] }));
});

test("tags paired tracks by translation language and keeps the fox and reading-mode order", () => {
  const scripts = ["japanese", "katakana", "hiragana", "romaji", "kana"];
  const publication = { version: 1, tracks: scripts.flatMap((script, i) => [
    { ...track, script, lang: "eng", id: String(i + 1).repeat(64) },
    { ...track, script, lang: "por", id: (i + 6).toString(16).repeat(64) },
  ]) };
  const before = structuredClone(publication);
  const result = subtitles(validateIndex(publication), "series", "tt1234567:1:1");
  assert.deepEqual(result.map(t => [t.lang, t.label]), [
    ["eng", "🦊 Romaji"], ["por", "🦊 Romaji"],
    ["eng", "🦊 Kana"], ["por", "🦊 Kana"],
    ["eng", "🦊 Japanese"], ["por", "🦊 Japanese"],
  ]);
  assert.deepEqual(publication, before);
});

test("prefers anchored versions and omits retired modes from the picker", () => {
  const otherLanguage = { ...track, id: "2".repeat(64), lang: "por" };
  const legacyMode = { ...track, id: "3".repeat(64), script: "hiragana" };
  const replacement = { ...track, id: "4".repeat(64), anchor: "a".repeat(64) };
  const otherEpisode = { ...replacement, id: "5".repeat(64), videoIds: ["tt1234567:1:2"] };
  const publication = { version: 1, tracks: [track, otherLanguage, legacyMode, replacement, otherEpisode] };
  assert.deepEqual(subtitles(publication, "series", "tt1234567:1:1").map(t => t.id),
    [otherLanguage.id, replacement.id]);
  assert.deepEqual(subtitles({ version: 1, tracks: [track, otherEpisode] }, "series", "tt1234567:1:1").map(t => t.id),
    [track.id]);
});

test("offers the current anchored revision while retaining the previous track in the library", () => {
  const anchor = "a".repeat(64);
  const previous = { ...track, id: "2".repeat(64), anchor, superseded: true };
  const current = { ...track, id: "3".repeat(64), anchor };
  const publication = validateIndex({ version: 1, tracks: [track, previous, current] });
  assert.deepEqual(subtitles(publication, "series", "tt1234567:1:1").map(t => t.id), [current.id]);
  assert.deepEqual(publication.tracks.find(t => t.id === previous.id), previous);
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

test("Stremio advertises the direct asset URL and old website links redirect to it", async () => {
  const ready = { ...track, playbackReady: true };
  const publication = { index: { ...index, tracks: [ready] }, publication: "a".repeat(64) };
  const assetOrigin = "https://assets.yomiru.tsilva.eu";
  const assetUrl = pathname => `${assetOrigin}${pathname}`;
  const discovery = subtitleDiscovery({ readLibrary: async () => publication, tracksStore: () => null,
    assetOrigin: () => assetOrigin, store: { observe: async () => {} } });
  const download = libraryDownload({ getAssetUrl: assetUrl, hasSubtitle: async path => {
    assert.equal(path, track.path);
    return true;
  } });
  const makeResponse = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.code = code; return this; }, end(body) { this.body = body; },
    redirect(code, location) { this.code = code; this.headers.Location = location; }, json(body) { this.body = body; } });
  for (const filename of ["one.mkv", "two.mkv"]) {
    const result = makeResponse();
    await discovery({ method: "GET", query: { type: track.type, id: track.videoIds[0], filename } }, result);
    assert.equal(result.body.subtitles[0].url, assetUrl(track.path));
    assert.equal(result.body.subtitles[0].id, track.id);
    assert.equal(result.headers["Cache-Control"], "public, max-age=30");
  }
  for (const method of ["GET", "HEAD"]) {
    const result = makeResponse();
    await download({ method, query: { file: `${sha256}.ass` } }, result);
    assert.equal(result.code, 307);
    assert.equal(result.headers.Location, assetUrl(track.path));
    assert.equal(result.body, undefined);
    assert.equal(result.headers["Cache-Control"], "public, max-age=31536000, immutable");
  }
  for (const [hasSubtitle, status] of [[async () => false, 404], [async () => { throw Error("offline"); }, 503]]) {
    const result = makeResponse();
    await libraryDownload({ hasSubtitle })({ method: "GET", query: { file: `${sha256}.ass` } }, result);
    assert.equal(result.code, status);
    assert.equal(result.headers["Cache-Control"], "no-store");
    assert.equal(result.headers.Location, undefined);
  }
});
