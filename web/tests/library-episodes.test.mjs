import assert from "node:assert/strict";
import test from "node:test";
import { episodeCode, groupEpisodes } from "../src/library-episodes.mjs";
import { browseEpisodes } from "../lib/browse.mjs";
import { browseFixture } from "./browse-fixture.mjs";

test("episode codes are padded without truncating large episode numbers", () => {
  assert.equal(episodeCode(1, 1), "S01E01");
  assert.equal(episodeCode(2, 2), "S02E02");
  assert.equal(episodeCode(0, 1), "S00E01");
  assert.equal(episodeCode(12, 100), "S12E100");
});

test("pagination joins a show's seasons in one group without losing numeric order", () => {
  const fixture = browseFixture(140);
  let cursor, rows = [];
  do {
    const page = browseEpisodes(fixture, { cursor });
    rows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);
  const before = structuredClone(rows);
  const [group] = groupEpisodes([...rows].reverse());
  assert.equal(group.rows.length, 140);
  assert.equal(groupEpisodes(rows).length, 1);
  assert.deepEqual(group.rows.map(row => episodeCode(row.season, row.episode)),
    before.map(row => episodeCode(row.season, row.episode)));
  assert.equal(episodeCode(group.rows.at(-1).season, group.rows.at(-1).episode), "S02E100");
  assert.deepEqual(rows, before);
});

test("different series with the same title keep independent groups", () => {
  const rows = [
    { id: "tt1234567:1:1", show: "Shared title", season: 1, episode: 1 },
    { id: "tt7654321:1:1", show: "Shared title", season: 1, episode: 1 },
    { id: "tt1234567:2:2", show: "Shared title", season: 2, episode: 2 },
  ];
  const groups = groupEpisodes(rows);
  assert.deepEqual(groups.map(group => group.id), ["tt1234567", "tt7654321"]);
  assert.deepEqual(groups.map(group => group.rows.length), [2, 1]);
});

test("episode-code search finds matches beyond the first page inside their show", () => {
  const fixture = browseFixture();
  const groups = groupEpisodes(browseEpisodes(fixture, { search: "s02e02" }).rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 1);
  assert.equal(groups[0].rows[0].id, "tt1234567:2:2");
  assert.deepEqual(groupEpisodes([]), []);
});

test("movie groups preserve their codes across search and pagination", () => {
  const fixture = browseFixture(28);
  const rebuildIds = ["tt0923811", "tt0860906", "tt0860907", "tt2458948"];
  const onePieceId = "tt0814243";
  const otherId = "tt7654321";
  const earlierId = "tt7654322";
  const filmNames = ["Zulu", "Bravo", "Charlie", "Alpha"];
  fixture.catalogue.movies = {
    ...Object.fromEntries(rebuildIds.map((id, i) => [id, { name: `Synthetic film ${filmNames[i]}` }])),
    [onePieceId]: { name: "Synthetic pirate film" },
    [otherId]: { name: "Synthetic recent film", year: "2020" },
    [earlierId]: { name: "Synthetic older film", year: 1980 },
  };
  for (const id of Object.keys(fixture.catalogue.movies)) {
    fixture.index.tracks.push({ type: "movie", videoIds: [id], script: "romaji", lang: "eng" });
  }

  const first = browseEpisodes(fixture);
  const rest = browseEpisodes(fixture, { cursor: first.nextCursor });
  const groups = groupEpisodes([...first.rows, ...rest.rows]);
  assert.deepEqual(groups.map(group => group.name),
    ["Synthetic show", "Rebuild of Evangelion", "One Piece Movies", "Other Movies"]);
  assert.deepEqual(groups[1].rows.map(row => row.id), rebuildIds);
  assert.deepEqual(groups[1].rows.map(row => row.code), ["M01", "M02", "M03", "M04"]);
  assert.deepEqual(groups[1].rows.map(row => row.stremioUrl), rebuildIds.map(id => `stremio:///detail/movie/${id}/${id}`));
  assert.deepEqual(groups[2].rows.map(row => [row.id, row.code]), [[onePieceId, "M01"]]);
  assert.deepEqual(groups[3].rows.map(row => [row.id, row.code]), [[earlierId, "M01"], [otherId, "M02"]]);

  const search = query => browseEpisodes(fixture, { search: query }).rows.map(row => row.id);
  assert.deepEqual(search("rebuild of evangelion"), rebuildIds);
  assert.deepEqual(search("rebuild charlie"), [rebuildIds[2]]);
  assert.deepEqual(search("m03"), [rebuildIds[2]]);
  assert.deepEqual(search("one piece m01"), [onePieceId]);
  assert.deepEqual(search("other movies m02"), [otherId]);
  assert.deepEqual(search("movies"), [...rebuildIds, onePieceId, earlierId, otherId]);
  assert.deepEqual(browseEpisodes(fixture, { show: groups[1].id }).rows.map(row => row.id), rebuildIds);
  assert.deepEqual(browseEpisodes(fixture, { show: groups[2].id }).rows.map(row => row.id), [onePieceId]);
  assert.deepEqual(browseEpisodes(fixture, { show: groups[3].id }).rows.map(row => row.id), [earlierId, otherId]);
  assert.deepEqual(browseEpisodes(fixture, { show: "movie:Movies" }).rows.map(row => row.id), [earlierId, otherId]);

  fixture.index.tracks = fixture.index.tracks.filter(track => !track.videoIds.includes(rebuildIds[0]));
  assert.equal(browseEpisodes(fixture, { show: groups[1].id }).rows[0].code, "M02");
});
