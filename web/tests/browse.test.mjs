import assert from "node:assert/strict";
import test from "node:test";
import { browseEpisodes, episodeRows, pageSize } from "../lib/browse.mjs";
import { createHandler } from "../api/browse.mjs";

import { browseFixture } from "./browse-fixture.mjs";

test("one row per covered episode, deduplicated translations and no media or timing column", () => {
  const fixture = browseFixture();
  const rows = episodeRows(fixture.index, fixture.catalogue);
  assert.equal(rows.length, 65);
  assert.deepEqual(rows[0].translations, [{ code: "eng", label: "English" }, { code: "por", label: "Portuguese" }]);
  assert.equal(rows[0].stremioUrl, "stremio:///detail/series/tt1234567/tt1234567:1:1");
  assert.deepEqual([rows[39].season, rows[39].episode, rows[40].season, rows[40].episode], [1, 40, 2, 1]);
  assert.equal("poster" in rows[0], false);
  assert.equal("timing" in rows[0], false);
  assert.equal("script" in rows[0], false);
});

test("bounded cursor pages visit every episode once and stop at the final page", () => {
  const fixture = browseFixture();
  let cursor, rows = [], lengths = [];
  do {
    const page = browseEpisodes(fixture, { cursor });
    lengths.push(page.rows.length);
    rows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(lengths, [pageSize, pageSize, 5]);
  assert.equal(new Set(rows.map(row => row.id)).size, 65);
});

test("search covers show, episode, season and target language across all pages", () => {
  const fixture = browseFixture();
  for (const search of ["SYNTHETIC SHOW", "season 2", "S02E01", "Portuguese", "Synthetic episode 1-35"]) {
    const result = browseEpisodes(fixture, { search });
    assert.ok(result.rows.length > 0, search);
  }
  assert.equal(browseEpisodes(fixture, { search: "Portuguese" }).rows.length, 1);
  assert.deepEqual(browseEpisodes(fixture, { search: "not published" }), { rows: [], nextCursor: null });
});

test("cursor is tied to publication and query, rejecting malformed and stale requests", () => {
  const fixture = browseFixture();
  const { nextCursor: cursor } = browseEpisodes(fixture);
  assert.throws(() => browseEpisodes({ ...fixture, publication: "b".repeat(64) }, { cursor }), e => e.status === 409);
  const previousCursor = Buffer.from(JSON.stringify({ publication: fixture.publication, search: "", offset: 30 })).toString("base64url");
  assert.throws(() => browseEpisodes(fixture, { cursor: previousCursor }), e => e.status === 409);
  assert.throws(() => browseEpisodes(fixture, { cursor, search: "other" }), e => e.status === 400);
  for (const query of [{ cursor: "!" }, { cursor: "bnVsbA" }, { search: ["bad"] }, { cursor: ["bad"] }, { search: "x".repeat(201) }]) {
    assert.throws(() => browseEpisodes(fixture, query), e => e.status === 400);
  }
  assert.deepEqual(browseEpisodes({ ...fixture, index: { tracks: [] } }), { rows: [], nextCursor: null });
});

test("exact show filtering covers all seasons and binds its pagination cursor to that show", () => {
  const fixture = browseFixture();
  fixture.index.tracks.push({ ...fixture.index.tracks[0], videoIds: ["tt7654321:1:1"] });
  fixture.catalogue.shows.tt7654321 = { name: "Another show", videos: [{ id: "tt7654321:1:1", title: "Other episode" }] };
  const first = browseEpisodes(fixture, { show: "tt1234567" });
  assert.equal(first.rows.length, 30);
  assert.ok(first.rows.every(row => row.id.startsWith("tt1234567:")));
  assert.equal(browseEpisodes(fixture, { show: "tt7654321" }).rows.length, 1);
  assert.throws(() => browseEpisodes(fixture, { cursor: first.nextCursor, show: "tt7654321" }), e => e.status === 400);
  assert.throws(() => browseEpisodes(fixture, { show: ["tt1234567"] }), e => e.status === 400);
});

function responseRecorder() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; }, end() {} };
}

test("public endpoint is read-only, paginated and distinguishes storage failure from no coverage", async () => {
  const fixture = browseFixture();
  fixture.catalogue.shows.tt1234567.videos[0].overview = "A synthetic episode synopsis.";
  let reads = 0;
  const handler = createHandler({ readLibrary: async () => { reads++; return fixture; } });
  const write = responseRecorder();
  await handler({ method: "POST", query: {} }, write);
  assert.equal(write.code, 405);
  assert.equal(reads, 0);
  const response = responseRecorder();
  await handler({ method: "GET", query: {} }, response);
  assert.equal(response.code, 200);
  assert.equal(response.body.rows.length, 30);
  assert.equal(response.body.rows[0].description, "A synthetic episode synopsis.");
  assert.equal(response.body.rows[1].description, null);
  assert.equal(response.headers["X-Yomiru-Publication"], fixture.publication);
  assert.equal(response.headers["Cache-Control"], "public, max-age=30");
  const head = responseRecorder();
  await handler({ method: "HEAD", query: {} }, head);
  assert.equal(head.code, 200);
  assert.equal(head.body, undefined);
  const failed = responseRecorder();
  await createHandler({ readLibrary: async () => { throw new Error("Private failure detail"); } })({ method: "GET", query: {} }, failed);
  assert.equal(failed.code, 503);
  assert.equal(failed.headers["Cache-Control"], "no-store");
  assert.doesNotMatch(JSON.stringify(failed.body), /Private failure/);
});

test("incremental browse fallback adds synopses from the matching publication", async () => {
  const fixture = browseFixture(1);
  fixture.catalogue.shows.tt1234567.videos[0].overview = "A synthetic episode synopsis.";
  const handler = createHandler({
    readLibrary: async () => fixture,
    store: () => ({
      incremental: true, current: async () => fixture.publication,
      browse: async () => episodeRows(fixture.index, fixture.catalogue),
    }),
  });
  const response = responseRecorder();
  await handler({ method: "GET" }, response);
  assert.equal(response.code, 200);
  assert.equal(response.body.rows[0].description, "A synthetic episode synopsis.");
});

test("a stale default-page cursor can recover through an uncached first page", async () => {
  let fixture = browseFixture();
  const handler = createHandler({ readPostgres: async query => ({
    publication: fixture.publication, page: browseEpisodes(fixture, query),
  }) });
  const first = responseRecorder();
  await handler({ method: "GET" }, first);
  assert.equal(first.headers["Cache-Control"], "public, max-age=30");

  fixture = { ...fixture, publication: "b".repeat(64) };
  const stale = responseRecorder();
  await handler({ method: "GET", query: { cursor: first.body.nextCursor } }, stale);
  assert.equal(stale.code, 409);
  assert.equal(stale.headers["Cache-Control"], "no-store");

  const fresh = responseRecorder();
  await handler({ method: "GET", query: { fresh: "1" } }, fresh);
  assert.equal(fresh.code, 200);
  assert.equal(fresh.headers["X-Yomiru-Publication"], fixture.publication);
  assert.equal(fresh.headers["Cache-Control"], "no-store");
  assert.notEqual(fresh.body.nextCursor, first.body.nextCursor);

  const next = responseRecorder();
  await handler({ method: "GET", query: { cursor: fresh.body.nextCursor } }, next);
  assert.equal(next.code, 200);
});

test("movies use snapshot metadata and standard movie links even with a series-only Neon index", async () => {
  const fixture = browseFixture();
  const id = "tt7654321";
  fixture.index.tracks.push(
    { type: "movie", videoIds: [id], lang: "eng", script: "romaji" },
    { type: "movie", videoIds: [id], lang: "por", script: "romaji", superseded: true },
  );
  fixture.catalogue.movies = { [id]: { name: "Synthetic film", year: "2026", description: "A synthetic film synopsis." } };
  const response = responseRecorder();
  await createHandler({ readLibrary: async () => fixture, store: () => ({
    browse: async () => { throw new Error("Series-only store cannot return movies"); },
  }) })({ method: "GET", query: { search: "film 2026" } }, response);
  assert.equal(response.code, 200);
  assert.deepEqual(response.body, { rows: [{
    type: "movie", id, show: "Other Movies", code: "M01", title: "Synthetic film", year: "2026",
    translations: [{ code: "eng", label: "English" }],
    stremioUrl: `stremio:///detail/movie/${id}/${id}`,
    vocabulary: null, description: "A synthetic film synopsis.",
  }], nextCursor: null });
  assert.equal(browseEpisodes(fixture, { search: "s02e01" }).rows.length, 1);
});

test("Rebuild titles use subtitle editions and remain searchable by theatrical title", () => {
  const fixture = browseFixture(0);
  const titles = [
    ["tt0923811", "1.0", "1.11", "You Are (Not) Alone"],
    ["tt0860906", "2.0", "2.22", "You Can (Not) Advance"],
    ["tt0860907", "3.0", "3.33", "You Can (Not) Redo"],
    ["tt2458948", "3.0+1.0", "3.0+1.01", "Thrice Upon a Time"],
  ];
  fixture.catalogue.movies = Object.fromEntries(titles.map(([id, theatrical, , name]) =>
    [id, { name: `Evangelion: ${theatrical} ${name}` }]));
  fixture.index.tracks = titles.map(([id]) => ({ type: "movie", videoIds: [id], lang: "eng" }));
  for (const [id, theatrical, edition, name] of titles) {
    for (const version of [theatrical, edition]) {
      const { rows } = browseEpisodes(fixture, { search: `Evangelion: ${version} ${name}` });
      assert.deepEqual(rows.map(row => [row.id, row.title, row.stremioUrl]), [
        [id, `Evangelion: ${edition} ${name}`, `stremio:///detail/movie/${id}/${id}`],
      ]);
    }
  }
});

test("standalone romaji films use theatrical codes and keep translation coverage separate", () => {
  const fixture = browseFixture(0);
  fixture.catalogue.movies = {
    tt1865467: { name: "Synthetic 3D film", year: "2011" },
    tt1485763: { name: "Synthetic earlier film", year: "2013" },
    tt0814243: { name: "Synthetic first film", year: "2000" },
    tt16183464: { name: "Synthetic former film", year: "2022" },
  };
  fixture.index.tracks = [
    { type: "movie", videoIds: ["tt1865467"], lang: "jpn", script: "romaji" },
    { type: "movie", videoIds: ["tt1485763"], lang: "jpn", script: "romaji" },
    { type: "movie", videoIds: ["tt0814243"], lang: "eng", script: "romaji" },
    { type: "movie", videoIds: ["tt0814243"], lang: "jpn", script: "romaji" },
    { type: "movie", videoIds: ["tt16183464"], lang: "jpn", script: "romaji", superseded: true },
  ];

  const query = { show: "movie:One Piece Movies", search: "romaji" };
  const { rows } = browseEpisodes(fixture, query);
  assert.deepEqual(rows.map(({ id, code }) => [id, code]), [
    ["tt0814243", "M01"], ["tt1485763", "M10"], ["tt1865467", "M11"],
  ]);
  assert.deepEqual(rows.map(row => row.translations), [[{ code: "eng", label: "English" }], [], []]);
  assert.deepEqual(rows.map(row => row.readingModes), Array(3).fill([{ code: "romaji", label: "Rōmaji" }]));
});
