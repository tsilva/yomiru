import assert from "node:assert/strict";
import test from "node:test";
import { filterLibraryRows, librarySearchTerms } from "../src/library-episodes.mjs";
import { readLibrarySnapshot } from "../src/library-snapshot.mjs";

const endpoint = "/api/browse?fresh=1";
const episode = { id: "tt1234567:2:4", show: "Synthetic Series", title: "Sample",
  season: 2, episode: 4, translations: [{ code: "eng", label: "English" }],
  stremioUrl: "stremio:///detail/series/tt1234567/tt1234567:2:4" };
const movie = { id: "tt0923811", type: "movie", show: "Rebuild of Evangelion",
  title: "Evangelion: 1.11 You Are (Not) Alone", code: "M01",
  translations: [{ code: "por", label: "Portuguese" }],
  stremioUrl: "stremio:///detail/movie/tt0923811/tt0923811" };

function page(publication, rows, nextCursor = null) {
  return Response.json({ rows, nextCursor }, { headers: { "X-Yomiru-Publication": publication } });
}

test("an unchanged bundled catalogue requires only a background HEAD request", async () => {
  const fetcher = async (url, options) => {
    assert.equal(url, endpoint);
    assert.equal(options.method, "HEAD");
    return new Response(null, { headers: { "X-Yomiru-Publication": "active" } });
  };
  assert.equal(await readLibrarySnapshot({ publication: "active", fetcher }), null);
});

test("a new publication is downloaded in full and can be searched without the API", async () => {
  const requests = [];
  const fetcher = async (url, { method = "GET" }) => {
    requests.push([method, url]);
    if (method === "HEAD") return new Response(null, { headers: { "X-Yomiru-Publication": "active" } });
    return url === endpoint ? page("active", [episode], "next") : page("active", [movie]);
  };
  const snapshot = await readLibrarySnapshot({ publication: "previous", fetcher });
  assert.deepEqual(snapshot, { publication: "active", rows: [episode, movie] });
  for (const [query, row] of [["Ｓ０２Ｅ０４ English", episode], ["1.0 Portuguese", movie], ["M01", movie]]) {
    assert.deepEqual(filterLibraryRows(snapshot.rows, { terms: librarySearchTerms(query) }), [row]);
  }
  assert.deepEqual(requests, [["HEAD", endpoint], ["GET", endpoint], ["GET", endpoint + "&cursor=next"]]);
});

test("a change mid-download retries from page one without mixing pending rows", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    if (calls === 1) return page("previous", [episode], "previous-cursor");
    if (calls === 2) return new Response(null, { status: 409 });
    return page("active", [movie]);
  };
  assert.deepEqual(await readLibrarySnapshot({ fetcher }), { publication: "active", rows: [movie] });
  assert.equal(calls, 3);
});

test("a partial or malformed refresh never becomes the active snapshot", async () => {
  const fetcher = async url => url === endpoint ? page("active", [episode], "next") : page("active", [episode]);
  await assert.rejects(readLibrarySnapshot({ fetcher }), /repeated a title/);
});
