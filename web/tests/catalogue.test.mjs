import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  coveredShows, metadataSnapshot, showMetadata, validateSnapshot,
} from "../lib/catalogue.mjs";
import { createHandler } from "../api/catalogue.mjs";

const readManifest = async () => JSON.parse(await readFile(new URL("../public/manifest.json", import.meta.url), "utf8"));

async function requestCatalogue(handler, query, method = "GET") {
  const response = {
    headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.code = code; return this; }, end() {}, json(body) { this.body = body; },
  };
  await handler({ method, query }, response);
  return response;
}

const source = { label: "Synthetic Japanese source", url: "https://example.test/source" };
const tracks = [1, 2].flatMap(episode => ["romaji", "hiragana", "katakana", "japanese"].map(script => ({
  videoIds: [`tt1234567:1:${episode}`], type: "series", lang: "eng", script, source,
})));
const index = { version: 1, revision: "synthetic-revision", tracks };
const originalShow = {
  id: "tt1234567", name: "Synthetic show", poster: "https://example.test/poster.png",
  type: "series", background: "https://example.test/background.jpg",
  logo: "https://example.test/logo.png", posterShape: "poster", releaseInfo: "2020–2021",
  awards: "A synthetic award", cast: ["Original Actor"], country: "Japan",
  director: null, writer: ["Original Writer"], genre: ["Animation"], genres: ["Animation"],
  imdbRating: "8.2", imdb_id: "tt1234567", tvdb_id: 123, moviedb_id: 456,
  popularity: 0.5, popularities: { moviedb: 12.3, stremio: 0.5 },
  released: "2020-01-01T00:00:00.000Z", dvdRelease: null, runtime: "24 min",
  status: "Ended", year: "2020–2021", language: "Japanese",
  slug: "series/synthetic-show-1234567", website: "https://example.test/show",
  trailers: [{ source: "abcdefghijk", type: "Trailer" }],
  trailerStreams: [{ title: "Original trailer", ytId: "abcdefghijk" }],
  links: [{ name: "8.2", category: "imdb", url: "https://imdb.com/title/tt1234567" },
    { name: "Original Actor", category: "Cast", url: "stremio:///search?search=Original%20Actor" }],
  behaviorHints: { defaultVideoId: null, hasScheduledVideos: true },
  description: "An original synthetic series synopsis.",
  videos: [1, 2, 3].map(episode => ({
    id: `tt1234567:1:${episode}`, season: 1, episode, name: `Synthetic episode ${episode}`,
    overview: `An original synopsis for synthetic episode ${episode}.`,
    description: `An original synopsis for synthetic episode ${episode}.`,
    number: episode, firstAired: "2020-01-01T00:00:00.000Z", rating: 7.5,
    moviedb_id: 1000 + episode, thumbnail: `https://example.test/${episode}.jpg`,
    released: "2020-01-01T00:00:00.000Z",
  })),
};
const show = metadataSnapshot(originalShow, originalShow.id);
const snapshot = { version: 1, libraryRevision: index.revision, shows: { tt1234567: show } };

test("original series and episode metadata survive publication and legacy Stremio details", () => {
  const saved = JSON.parse(JSON.stringify(snapshot));
  const validated = validateSnapshot(saved, index);
  const meta = showMetadata(index, validated, "series", "yomiru:tt1234567");
  for (const [key, value] of Object.entries(originalShow)) {
    if (["id", "videos"].includes(key)) continue;
    assert.deepEqual(meta[key], value, `series ${key}`);
  }
  assert.equal(meta.id, "yomiru:tt1234567");
  assert.equal(meta.videos.length, 2);
  for (const video of meta.videos) {
    const original = originalShow.videos.find(v => v.id === video.id);
    for (const [key, value] of Object.entries(original)) {
      assert.deepEqual(video[key], value, `episode ${key}`);
    }
    assert.equal(video.title, original.name);
  }
});

test("four display modes count once per episode and only published episodes appear", () => {
  const meta = showMetadata(index, snapshot, "series", "yomiru:tt1234567");
  assert.deepEqual(meta.videos.map(v => v.id), ["tt1234567:1:1", "tt1234567:1:2"]);
  assert.equal(meta.description, show.description);
  assert.equal(meta.videos[0].title, "Synthetic episode 1");
  assert.equal(meta.videos.some(v => v.episode === 3), false);
});

test("movie metadata matches bare IMDb IDs and excludes playback transports", () => {
  const id = "tt7654321";
  const movieIndex = { ...index, tracks: [...index.tracks, { type: "movie", videoIds: [id] }] };
  const movie = { id, type: "movie", name: "Synthetic film", year: "2026", streams: [{}], videos: [{}] };
  const saved = { ...snapshot, movies: { [id]: movie } };
  assert.deepEqual(JSON.parse(JSON.stringify(validateSnapshot(saved, movieIndex).movies[id])),
    { id, type: "movie", name: "Synthetic film", year: "2026" });
  assert.throws(() => validateSnapshot({ ...saved, movies: { [id]: { ...movie, type: "series" } } }, movieIndex),
    /metadata identity/);
  assert.equal(validateSnapshot(snapshot, movieIndex).movies, undefined);
});

test("published episode synopses survive snapshot validation without subtitle status or streams", () => {
  const meta = showMetadata(index, validateSnapshot(snapshot, index), "series", "yomiru:tt1234567");
  for (const video of meta.videos) {
    assert.equal(video.title, `Synthetic episode ${video.episode}`);
    assert.equal(video.overview, `An original synopsis for synthetic episode ${video.episode}.`);
    assert.equal("streams" in video, false);
    assert.equal("available" in video, false);
  }
  assert.equal("streams" in meta, false);
  assert.equal(showMetadata(index, snapshot, "series", "tt1234567"), null);
  assert.equal(showMetadata(index, snapshot, "series", "yomiru:tt9999999"), null);
});

test("description-only metadata is preserved and missing synopses stay empty", () => {
  const normalized = metadataSnapshot({ ...show, videos: [
    { ...show.videos[0], overview: undefined, description: "A source-provided episode synopsis." },
    { ...show.videos[1], overview: undefined, description: undefined },
  ] }, show.id);
  const meta = showMetadata(index, validateSnapshot({ ...snapshot, shows: {
    [show.id]: normalized,
  } }, index), "series", "yomiru:tt1234567");
  assert.equal(meta.videos[0].overview, "A source-provided episode synopsis.");
  assert.equal(meta.videos[1].overview, "");
});

test("the hosted manifest adds fox-branded Discover listings and leaves canonical details to Cinemeta", async () => {
  const manifest = await readManifest();
  assert.equal(manifest.id, "community.yomiru.published");
  assert.equal(manifest.logo, "https://yomiru.tsilva.eu/assets/fox.png");
  assert.deepEqual(manifest.resources, ["subtitles", "catalog"]);
  assert.deepEqual(manifest.types, ["series", "movie"]);
  assert.deepEqual(manifest.catalogs, [
    { type: "movie", id: "published-movies", name: "🦊 Yomiru", extra: [{ name: "skip" }] },
    { type: "series", id: "published-series", name: "🦊 Yomiru", extra: [{ name: "skip" }] },
  ]);
});

test("Discover tracks the published library through the same manifest routes", async () => {
  const movieId = "tt2222222";
  const inactiveId = "tt3333333";
  const alternateId = "tt4444444";
  const movies = {
    [movieId]: { id: movieId, name: "Synthetic film" },
    [inactiveId]: { id: inactiveId, name: "Retired film" },
    [alternateId]: { id: alternateId, name: "Unpublished film" },
  };
  let library = { index, catalogue: snapshot, publication: "first" };
  const handler = createHandler({ readLibrary: async () => library });
  const [movie, series] = (await readManifest()).catalogs
    .map(({ type, id }) => ({ resource: "catalog", type, id }));

  const initialSeries = await requestCatalogue(handler, series);
  assert.equal(initialSeries.code, 200);
  assert.equal(initialSeries.headers["Access-Control-Allow-Origin"], "*");
  assert.equal(initialSeries.headers["X-Yomiru-Publication"], "first");
  assert.deepEqual(initialSeries.body.metas.map(({ id, type, name, poster }) => ({ id, type, name, poster })),
    [{ id: show.id, type: "series", name: show.name, poster: show.poster }]);
  assert.equal(Object.hasOwn(initialSeries.body.metas[0], "videos"), false);
  assert.deepEqual((await requestCatalogue(handler, movie)).body.metas, []);

  const expanded = {
    ...index, revision: "expanded", tracks: [
      ...index.tracks,
      ...["romaji", "hiragana"].map(script => ({ type: "movie", videoIds: [movieId], script })),
      { type: "movie", videoIds: [inactiveId], superseded: true },
      { type: "movie", videoIds: ["kitsu:100"] },
    ],
  };
  library = {
    index: expanded,
    catalogue: { ...snapshot, libraryRevision: expanded.revision, movies },
    publication: "second",
  };
  const publishedMovies = await requestCatalogue(handler, movie);
  assert.equal(publishedMovies.headers["X-Yomiru-Publication"], "second");
  assert.deepEqual(publishedMovies.body.metas.map(({ id, type, name }) => ({ id, type, name })),
    [{ id: movieId, type: "movie", name: movies[movieId].name }]);
  assert.equal(publishedMovies.body.metas[0].behaviorHints.defaultVideoId, movieId);
  assert.equal(Object.hasOwn(publishedMovies.body.metas[0], "videos"), false);
  assert.deepEqual((await requestCatalogue(handler, { ...movie, extra: "skip=1" })).body.metas, []);
  assert.deepEqual((await requestCatalogue(handler, { ...movie, extra: "skip=-1" })).body.metas, []);
  assert.equal((await requestCatalogue(handler, movie, "HEAD")).body, undefined);

  const retired = { ...expanded, tracks: expanded.tracks.map(track =>
    track.type === "series" ? { ...track, superseded: true } : track) };
  library = { ...library, index: retired, publication: "third" };
  assert.deepEqual((await requestCatalogue(handler, series)).body.metas, []);
});

test("metadata cannot invent coverage, substitute identities or expose credential URLs", () => {
  assert.throws(() => metadataSnapshot({ ...show, id: "tt9999999" }, "tt1234567"));
  assert.throws(() => metadataSnapshot({ ...show, type: "movie" }, show.id));
  assert.throws(() => validateSnapshot({ ...snapshot, libraryRevision: "stale" }, index));
  const sanitized = validateSnapshot({ ...snapshot, shows: {
    tt1234567: { ...show, poster: "https://user:secret@example.test/poster.png" },
  } }, index);
  assert.equal(sanitized.shows.tt1234567.poster, undefined);
  assert.throws(() => coveredShows({ tracks: [{ ...tracks[0], videoIds: ["kitsu:123:1"] }] }));
});

test("metadata excludes unsafe links and playback overrides while preserving original navigation", () => {
  const unsafe = metadataSnapshot({ ...originalShow,
    website: "javascript:alert(1)",
    links: [...originalShow.links,
      { name: "Bad", category: "Cast", url: "https://user:secret@example.test/" },
      { name: "Bad", category: "Cast", url: "javascript:alert(1)" },
      { name: "Subtitle sources & feedback", category: "Yomiru", url: "https://example.test/feedback" }],
    behaviorHints: { defaultVideoId: "tt1234567:1:3", hasScheduledVideos: true },
    videos: originalShow.videos.map(v => ({ ...v, streams: [{ url: "https://example.test/video" }],
      available: true, behaviorHints: { defaultVideoId: "wrong" } })),
  }, originalShow.id);
  const meta = showMetadata(index, { ...snapshot, shows: { [show.id]: unsafe } }, "series", "yomiru:tt1234567");
  assert.deepEqual(meta.links, originalShow.links);
  assert.equal(meta.website, undefined);
  assert.deepEqual(meta.behaviorHints, { defaultVideoId: null, hasScheduledVideos: true });
  for (const video of meta.videos) {
    for (const key of ["streams", "available", "behaviorHints"]) assert.equal(Object.hasOwn(video, key), false);
  }
});

test("a new publication automatically changes legacy detail episode coverage", () => {
  const expanded = { ...index, tracks: [...tracks, { ...tracks[0], videoIds: ["tt1234567:1:3"] }] };
  assert.equal(showMetadata(expanded, snapshot, "series", "yomiru:tt1234567").videos.length, 3);
});

test("retired catalogue returns an empty list to older installations", async () => {
  const handler = createHandler({ readLibrary: async () => assert.fail("Retired catalog should not read the library") });
  for (const [method, expected] of [["GET", 200], ["POST", 405], ["OPTIONS", 204]]) {
    const query = { resource: "catalog", type: "series", id: "available", extra: "search=Synthetic&skip=0" };
    const response = await requestCatalogue(handler, query, method);
    assert.equal(response.code, expected);
    assert.equal(response.headers["Access-Control-Allow-Origin"], "*");
    if (method === "GET") assert.deepEqual(response.body, { metas: [], cacheMaxAge: 30 });
  }
});
