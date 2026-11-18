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
