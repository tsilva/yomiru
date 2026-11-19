import assert from "node:assert/strict";
import test from "node:test";
import { fetchPublicVocabularySelection } from "../scripts/public-vocabulary-preview.mjs";

const publication = "a".repeat(64);
const revision = "b".repeat(64);
const registry = "c".repeat(64);
const publicationHeader = "X-Yomiru-Publication";
const headers = { [publicationHeader]: publication };
const episode = { id: "tt123:1:1", vocabulary: { sha256: revision, registry } };
const movie = { id: "tt456", type: "movie", vocabulary: { sha256: revision } };

test("public preview resolves every listed vocabulary title when no titles are checked", async () => {
  const requests = [];
  const result = await fetchPublicVocabularySelection({ mode: "summary", scope: "all" }, async (url, options) => {
    requests.push(url.pathname + url.search);
    if (url.pathname === "/api/vocabulary-selection") {
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), {
        mode: "summary", episodes: [{ id: episode.id, revision, registry }, { id: movie.id, revision }],
      });
      return Response.json({ total: 30, covered: { eng: 28 } }, { headers });
    }
    const cursor = url.searchParams.get("cursor");
    return Response.json(cursor ? { rows: [movie], nextCursor: null }
      : { rows: [episode, { id: "tt789" }], nextCursor: "page-two" }, { headers });
  });
  assert.deepEqual(requests, ["/api/browse", "/api/browse?cursor=page-two", "/api/vocabulary-selection"]);
  assert.equal(result.headers.get(publicationHeader), publication);
  assert.deepEqual(await result.json(), {
    total: 30, covered: { eng: 28 }, publication, episodeCount: 2, movieCount: 1,
  });
});

test("public preview reports a stale library if the vocabulary and browse revisions differ", async () => {
  const result = await fetchPublicVocabularySelection({ mode: "study", scope: "all", publication }, async url => (
    url.pathname === "/api/browse"
      ? Response.json({ rows: [episode], nextCursor: null }, { headers })
      : Response.json({ words: [] }, { headers: { [publicationHeader]: "d".repeat(64) } })
  ));
  assert.equal(result.status, 409);
});
