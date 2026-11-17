import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogue, coveredShows, metadataSnapshot, showMetadata, validateSnapshot,
} from "../lib/catalogue.mjs";
import handler from "../api/catalogue.mjs";

const source = { label: "Synthetic Japanese source", url: "https://example.test/source" };
const tracks = [1, 2].flatMap(episode => ["romaji", "hiragana", "katakana", "japanese"].map(script => ({
  videoIds: [`tt1234567:1:${episode}`], type: "series", lang: "eng", script, source,
})));
const index = { version: 1, revision: "synthetic-revision", tracks };
const show = metadataSnapshot({
  id: "tt1234567", name: "Synthetic show", poster: "https://example.test/poster.png",
  description: "An original synthetic series synopsis.",
  videos: [1, 2, 3].map(episode => ({
    id: `tt1234567:1:${episode}`, season: 1, episode, name: `Synthetic episode ${episode}`,
    released: "2020-01-01T00:00:00.000Z",
  })),
}, "tt1234567");
const snapshot = { version: 1, libraryRevision: index.revision, shows: { tt1234567: show } };

test("four display modes count once per episode and only published episodes appear", () => {
  const result = catalogue(index, snapshot, "series", "available");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "yomiru:tt1234567");
  assert.equal(result[0].name, show.name);
  assert.equal(result[0].description, show.description);
  const meta = showMetadata(index, snapshot, "series", result[0].id);
  assert.deepEqual(meta.videos.map(v => v.id), ["tt1234567:1:1", "tt1234567:1:2"]);
  assert.equal(meta.description, show.description);
  assert.equal(meta.videos[0].title, "Synthetic episode 1");
  assert.equal(meta.videos.some(v => v.episode === 3), false);
});

test("coverage and source labels do not claim video compatibility or provide streams", () => {
  const meta = showMetadata(index, snapshot, "series", "yomiru:tt1234567");
  for (const video of meta.videos) {
    assert.equal(video.title, `Synthetic episode ${video.episode}`);
    assert.match(video.overview, /Synthetic Japanese source/);
    assert.match(video.overview, /does not prove synchronization/);
    assert.equal("streams" in video, false);
    assert.equal("available" in video, false);
  }
  assert.equal("streams" in meta, false);
  assert.equal(showMetadata(index, snapshot, "series", "tt1234567"), null);
  assert.equal(showMetadata(index, snapshot, "series", "yomiru:tt9999999"), null);
});

test("search, pagination and unknown catalogue requests are bounded", () => {
  assert.equal(catalogue(index, snapshot, "series", "available", { search: "SYNTHETIC" }).length, 1);
  for (const extra of [{ search: "other" }, { skip: "100" }, { skip: "-1" }, { search: ["bad"] }]) {
    assert.deepEqual(catalogue(index, snapshot, "series", "available", extra), []);
  }
  assert.deepEqual(catalogue(index, snapshot, "movie", "available"), []);
  assert.deepEqual(catalogue(index, snapshot, "series", "unknown"), []);
});

test("metadata cannot invent coverage, substitute identities or expose credential URLs", () => {
  assert.throws(() => metadataSnapshot({ ...show, id: "tt9999999" }, "tt1234567"));
  assert.throws(() => validateSnapshot({ ...snapshot, libraryRevision: "stale" }, index));
  const sanitized = validateSnapshot({ ...snapshot, shows: {
    tt1234567: { ...show, poster: "https://user:secret@example.test/poster.png" },
  } }, index);
  assert.equal(sanitized.shows.tt1234567.poster, undefined);
  assert.throws(() => coveredShows({ tracks: [{ ...tracks[0], videoIds: ["kitsu:123:1"] }] }));
});

test("a new publication automatically changes catalogue episode coverage", () => {
  const expanded = { ...index, tracks: [...tracks, { ...tracks[0], videoIds: ["tt1234567:1:3"] }] };
  assert.equal(catalogue(expanded, snapshot, "series", "available")[0].name, show.name);
  assert.equal(showMetadata(expanded, snapshot, "series", "yomiru:tt1234567").videos.length, 3);
});

test("catalogue endpoint rejects writes and answers CORS preflight without loading data", () => {
  for (const [method, expected] of [["POST", 405], ["OPTIONS", 204]]) {
    const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.code = code; return this; }, end() {}, json(body) { this.body = body; } };
    handler({ method, query: {} }, response);
    assert.equal(response.code, expected);
    assert.equal(response.headers["Access-Control-Allow-Origin"], "*");
  }
});
