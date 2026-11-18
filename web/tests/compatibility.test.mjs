import assert from "node:assert/strict";
import test from "node:test";
import { requestRelease, videoGroups, createCompatibilityStore, publicGroup, voteSummary } from "../lib/compatibility.mjs";
import { createHandler as subtitleHandler } from "../api/subtitles.mjs";
import { createHandler as feedbackHandler } from "../api/compatibility.mjs";
import { fixture } from "./library-fixture.mjs";

function memoryStore() {
  const files = new Map();
  let revision = 0;
  const store = createCompatibilityStore({
    read: async key => files.has(key) ? structuredClone(files.get(key)) : null,
    write: async (key, state, etag) => {
      if ((files.get(key)?.etag || null) !== etag) return false;
      files.set(key, { state: structuredClone(state), etag: String(++revision) });
      return true;
    }, now: () => "2026-11-17T12:00:00.000Z",
  });
  return { store, files, writes: () => revision };
}
const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() {} });
const video = { type: "series", id: "tt1234567:1:1" };
const request = (query, method = "GET", body) => ({ method, query,
  headers: { host: "yomiru.tsilva.eu", origin: "https://yomiru.tsilva.eu", "content-type": "application/json" }, body });

test("source identity uses optional Stremio extras and does not retain local paths", () => {
  const release = requestRelease({ extra: "filename=%2Fprivate%2Fuser%2FExample.mkv&videoHash=ABCDEF1234567890&videoSize=1234" });
  assert.equal(release.filename, "Example.mkv");
  assert.equal(release.videoHash, "abcdef1234567890");
  assert.equal(release.videoSize, 1234);
  assert.equal(release.id, requestRelease({ filename: "Renamed.mkv", videoHash: release.videoHash, videoSize: "1234" }).id);
  assert.notEqual(release.id, requestRelease({ filename: "Example.mkv" }).id);
  assert.equal(requestRelease({}), null);
  assert.equal(requestRelease({ videoHash: "not-a-hash", videoSize: "-1" }), null);
});

test("seen sources start unrated; anonymous votes pool, replace and remain scoped to a revision", async () => {
  const data = fixture(), { store, files, writes } = memoryStore();
  const group = videoGroups(data.index, video.type, video.id)[0];
  const release = requestRelease({ filename: "Synthetic.release.mkv" });
  await store.observe(group, release);
  await store.observe(group, release);
  assert.equal(writes(), 1);
  let result = publicGroup(group, await store.get(group));
  assert.equal(result.releases[0].total, 0);
  assert.equal(result.releases[0].percentWorks, null);
  const yes = "a".repeat(64), no = "b".repeat(64);
  await Promise.all([store.vote(group, release.id, yes, true), store.vote(group, release.id, no, false)]);
  result = publicGroup(group, await store.get(group), yes);
  assert.equal(result.releases[0].percentWorks, 50);
  assert.equal(result.releases[0].total, 2);
  assert.equal(result.releases[0].myVote, true);
  assert(!JSON.stringify(result).includes(yes));
  assert(!JSON.stringify(result).includes('"votes"'));
  const count = writes();
  await store.vote(group, release.id, yes, true);
  assert.equal(writes(), count);
  await store.vote(group, release.id, yes, false);
  result = publicGroup(group, await store.get(group), yes);
  assert.deepEqual([result.releases[0].works, result.releases[0].doesntWork, result.releases[0].total], [0, 2, 2]);
  const changed = structuredClone(data.index); changed.tracks[0].sha256 = "d".repeat(64);
  const nextGroup = videoGroups(changed, video.type, video.id)[0];
  assert.notEqual(nextGroup.id, group.id);
  assert.equal(publicGroup(nextGroup, await store.get(nextGroup)).releases.length, 0);
  await assert.rejects(() => store.vote(nextGroup, release.id, yes, true));
  assert(!JSON.stringify([...files.values()]).includes(yes));
});

test("four modes share one source group; different source or generation does not inherit feedback", () => {
  const data = fixture();
  const first = data.index.tracks[0];
  data.index.tracks = ["romaji", "hiragana", "katakana", "japanese"].map((script, n) => ({ ...first, script, id: String(n).repeat(64) }));
  assert.equal(videoGroups(data.index, video.type, video.id).length, 1);
  data.index.tracks.push({ ...first, id: "e".repeat(64), generation: "different" });
  assert.equal(videoGroups(data.index, video.type, video.id).length, 2);
  assert.deepEqual(voteSummary(), { works: 0, doesntWork: 0, total: 0, percentWorks: null });
});

test("subtitle labels stay short while requests record release observations and retain feedback", async () => {
  const data = fixture(), { store } = memoryStore();
  const handler = subtitleHandler({ readLibrary: async () => data, store });
  const query = { ...video, extra: "filename=Synthetic.mkv&videoHash=1234567890abcdef&videoSize=456" };
  let result = response(); await handler(request(query), result);
  assert.equal(result.code, 200);
  assert.equal(result.body.subtitles[0].label, "🦊 Romaji");
  assert.equal(result.headers["X-Yomiru-Source-Status"], "recorded");
  const group = videoGroups(data.index, video.type, video.id)[0], release = requestRelease(query);
  await store.vote(group, release.id, "a".repeat(64), true);
  result = response(); await handler(request(query), result);
  assert.equal(result.body.subtitles[0].label, "🦊 Romaji");
  assert.equal(publicGroup(group, await store.get(group)).releases[0].percentWorks, 100);
  const broken = subtitleHandler({ readLibrary: async () => data, store: { observe: async () => { throw new Error("offline"); } } });
  result = response(); await broken(request(query), result);
  assert.equal(result.code, 200); assert.equal(result.body.subtitles.length, 1);
  assert.equal(result.body.subtitles[0].label, "🦊 Romaji");
  assert.equal(result.headers["X-Yomiru-Source-Status"], "unavailable");
  const unknown = response(); await handler(request({ type: "series", id: "unknown", filename: "Synthetic.mkv" }), unknown);
  assert.deepEqual(unknown.body.subtitles, []);
});

test("feedback API lists unconfirmed sources and rejects cross-origin, malformed and stale-revision votes", async () => {
  const data = fixture(), { store } = memoryStore();
  const group = videoGroups(data.index, video.type, video.id)[0], release = requestRelease({ filename: "Synthetic.mkv" });
  await store.observe(group, release);
  const handler = feedbackHandler({ readLibrary: async () => data, store });
  let result = response(); await handler(request(video), result);
  assert.equal(result.body.groups[0].releases[0].total, 0);
  const body = { ...video, groupId: group.id, releaseId: release.id, voter: "a".repeat(64), works: true };
  result = response(); await handler(request({}, "POST", body), result);
  assert.equal(result.code, 200); assert.equal(result.body.groups[0].releases[0].percentWorks, 100);
  assert.equal(result.body.groups[0].releases[0].myVote, true);
  const foreign = request({}, "POST", body); foreign.headers.origin = "https://example.test";
  result = response(); await handler(foreign, result); assert.equal(result.code, 403);
  result = response(); await handler(request({}, "POST", { ...body, works: "yes" }), result); assert.equal(result.code, 400);
  result = response(); await handler(request({}, "POST", { ...body, groupId: "f".repeat(64) }), result); assert.equal(result.code, 409);
});

test("slow observations continue under the invocation lifetime without delaying subtitle discovery", async () => {
  const data = fixture();
  let finish;
  const retained = [];
  const waiting = new Promise(resolve => { finish = resolve; });
  const release = requestRelease({ filename: "Synthetic.mkv" });
  const handler = subtitleHandler({ readLibrary: async () => data,
    store: { observe: async () => waiting }, observationBudgetMs: 1,
    background: promise => retained.push(promise),
  });
  const result = response();
  await handler(request({ ...video, filename: "Synthetic.mkv" }), result);
  assert.equal(result.code, 200);
  assert.equal(result.body.subtitles.length, 1);
  assert.equal(result.headers["X-Yomiru-Source-Status"], "pending");
  assert.equal(retained.length, 1);
  const originalLabel = result.body.subtitles[0].label;
  finish({ releases: { [release.id]: { votes: {} } } });
  await Promise.all(retained);
  assert.equal(result.body.subtitles[0].label, originalLabel);
});
