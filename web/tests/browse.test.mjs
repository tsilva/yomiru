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
  assert.throws(() => browseEpisodes(fixture, { cursor, search: "other" }), e => e.status === 400);
  for (const query of [{ cursor: "!" }, { cursor: "bnVsbA" }, { search: ["bad"] }, { cursor: ["bad"] }, { search: "x".repeat(201) }]) {
    assert.throws(() => browseEpisodes(fixture, query), e => e.status === 400);
  }
  assert.deepEqual(browseEpisodes({ ...fixture, index: { tracks: [] } }), { rows: [], nextCursor: null });
});

function responseRecorder() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; }, end() {} };
}

test("public endpoint is read-only, paginated and distinguishes storage failure from no coverage", async () => {
  const fixture = browseFixture();
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
  assert.equal(response.headers["X-Yomiru-Publication"], fixture.publication);
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
