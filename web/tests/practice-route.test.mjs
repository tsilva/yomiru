import assert from "node:assert/strict";
import test from "node:test";
import { loadPracticeTitle, parsePracticePath, titlePracticePath } from "../src/practice-route.mjs";

const episode = { id: "tt1234567:2:12", show: "Café & Friends!", season: 2, episode: 12, vocabulary: {} };
const movie = { id: "tt7654321", type: "movie", show: "Other Movies", title: "Two Friends" };

test("practice paths round-trip distinct episode and movie identities", () => {
  const path = titlePracticePath(episode);
  assert.equal(path, "/cafe-friends-tt1234567/s02e12/practice");
  assert.equal(parsePracticePath(`${path}/`).id, episode.id);
  assert.equal(parsePracticePath(titlePracticePath({ ...episode, id: "tt7654321:2:12" })).id, "tt7654321:2:12");
  const moviePath = titlePracticePath(movie);
  assert.equal(moviePath, "/other-movies/two-friends-tt7654321/practice");
  assert.equal(parsePracticePath(moviePath).id, movie.id);
  assert.equal(parsePracticePath("/compatibility"), null);
  assert.equal(parsePracticePath("/cafe-friends-tt1234567/s02e00/practice"), null);
});

test("a deep link loads only its exact episode across catalogue pages", async () => {
  const route = parsePracticePath(titlePracticePath(episode));
  const urls = [];
  const fetcher = async url => {
    urls.push(url);
    const firstPage = urls.length === 1;
    return Response.json({
      rows: firstPage ? [{ ...episode, id: "tt1234567:1:12" }] : [episode],
      nextCursor: firstPage ? "next" : null,
    }, { headers: { "X-Yomiru-Publication": "revision" } });
  };
  assert.deepEqual(await loadPracticeTitle(route, { fetcher }), { publication: "revision", title: episode });
  assert.deepEqual(urls, ["/api/browse?show=tt1234567&search=s02e12", "/api/browse?show=tt1234567&search=s02e12&cursor=next"]);
});

test("a missing title and a catalogue failure give different results", async () => {
  const route = parsePracticePath(titlePracticePath(movie));
  const fetcher = async url => {
    assert.equal(url, "/api/browse?show=tt7654321");
    return Response.json({ rows: [], nextCursor: null }, { headers: { "X-Yomiru-Publication": "revision" } });
  };
  assert.deepEqual(await loadPracticeTitle(route, { fetcher }), { publication: "revision", title: null });
  await assert.rejects(loadPracticeTitle(route, { fetcher: async () => new Response(null, { status: 503 }) }),
    /Could not load this title/);
});
