import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import postgres from "postgres";
import { fixture } from "./library-fixture.mjs";
import { activateR2Publication, loadPublicationRows } from "../lib/r2-publication.mjs";
import { createPrivateSourceStore, createR2Store } from "../lib/r2.mjs";
import { createPublicationStore } from "../lib/database.mjs";
import { createDatabaseReader, storage } from "../lib/published-library.mjs";
import { createDatabaseCompatibility, databaseFeedbackIO } from "../lib/database-feedback.mjs";
import { importBlobPage } from "../lib/import-blob.mjs";
import { createCompatibilityStore, publicGroup, requestRelease } from "../lib/compatibility.mjs";
import { createFeedbackLinks, feedbackContext } from "../lib/feedback-links.mjs";
import { createBlobRatings, createDatabaseRatings } from "../lib/subtitle-ratings.mjs";
import { encodeRegistry } from "../lib/vocabulary.mjs";
import { createSelectionHandler } from "../api/vocabulary-selection.mjs";
import { createHandler as createBrowseHandler } from "../api/browse.mjs";
import { createBlobVocabularyReader } from "../lib/episode-vocabulary.mjs";
import { filterVocabulary } from "../src/vocabulary-study.mjs";

const hash = data => createHash("sha256").update(data).digest("hex");
const origin = "https://r2.example.test";

function publication(meaning = "to walk") {
  const result = fixture([1, 2]);
  const lexeme = (name, reading, romaji, pos, meanings) => ({ id: `ja-${hash(name)}`, word: name, reading,
    romaji, pos, aliases: [], meanings, sources: {}, meaningStatus: {} });
  const shared = lexeme("歩く", "あるく", "aruku", "動詞", { eng: [meaning] });
  const uncovered = lexeme("舗道", "ほどう", "hodou", "名詞", { por: ["passeio"] });
  const registry = encodeRegistry({ version: 1, analysis: "test", entries: [shared, uncovered], dictionaries: [] });
  const { index, catalogue, assets } = result;
  assets.set(registry.descriptor.path, registry.bytes);
  index.registry = registry.descriptor;
  index.vocabulary = index.tracks.map((track, i) => {
    track.anchor = hash(`anchor-${i}`);
    const episodeWords = i === 0 ? [shared] : [shared, uncovered];
    const document = { version: 2, analysis: "test", anchor: track.anchor,
      words: episodeWords.map(({ id, word }) => ({ id, count: i + 1, forms: [id === shared.id ? "歩こう" : word],
        ...(i === 1 && id === shared.id && { formReadings: ["あるこう"] }),
        examples: [{ cue: "c00001", start: 1000, japanese: "舗道を少し歩こう。" }] })) };
    const bytes = Buffer.from(JSON.stringify(document)), sha256 = hash(bytes);
    const path = `/library/${sha256}.vocabulary.json`;
    assets.set(path, bytes);
    catalogue.shows.tt1234567.videos.push({ id: track.videoIds[0], season: 1, episode: i + 1, title: `Episode ${i + 1}` });
    return { videoIds: track.videoIds, bytes: bytes.length, sha256, path, anchor: track.anchor, words: episodeWords.length };
  });
  const bytes = Buffer.from(JSON.stringify({ version: 1, index, catalogue }));
  const revision = hash(bytes), path = `/library/snapshots/${revision}.json`;
  assets.set(path, bytes);
  return { ...result, publication: revision, pointer: { version: 1, sha256: revision, path },
    shared: shared.id, descriptors: index.vocabulary.map(entry =>
      ({ id: entry.videoIds[0], revision: entry.sha256, registry: registry.descriptor.sha256 })) };
}

const response = () => ({ statusCode: 200, headers: new Map(), setHeader(k, v) { this.headers.set(k, v); },
  status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; }, end(value) { this.body = value; } });

test("study searches the reading of a recorded kanji form across a mixed-revision selection", async () => {
  const published = publication();
  const rows = await loadPublicationRows(published.index, path => published.assets.get(path));
  assert.equal(rows.lexemes.find(({ id }) => id === published.shared).formReadings, undefined);
  assert.equal(rows.episodes[0].words.find(({ detail }) => detail.id === published.shared).detail.formReadings, undefined);
  assert.deepEqual(rows.episodes[1].words.find(({ detail }) => detail.id === published.shared).detail.formReadings, ["あるこう"]);

  const handler = createSelectionHandler({
    readLibrary: async () => published,
    store: () => null,
    readVocabulary: createBlobVocabularyReader(async url =>
      new Response(published.assets.get(new URL(url).pathname))),
  });
  const study = response();
  await handler({ method: "POST", body: { mode: "study", episodes: published.descriptors } }, study);
  assert.equal(study.statusCode, 200);
  const matches = filterVocabulary(study.body.words, "arukou");
  assert.deepEqual(matches.map(({ word, count, formReadings }) => [word, count, formReadings]),
    [["歩く", 3, ["あるこう"]]]);
  assert.deepEqual(filterVocabulary(study.body.words, "aruk").map(({ word }) => word), ["歩く"]);
});

test("R2 client signs only bucket objects and creates immutable files conditionally", async () => {
  const path = `library/${hash("synthetic track")}.ass`;
  const environment = {
    PUBLIC_R2_ORIGIN: origin, DATABASE_URL: "postgres://example.test/database",
    R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
    R2_BUCKET_NAME: "tracks", R2_ACCESS_KEY_ID: "fake-id", R2_SECRET_ACCESS_KEY: "fake-secret",
  };
  const calls = [];
  const objects = createR2Store(environment, { fetcher: async request => {
    assert.equal(request.redirect, "error");
    assert.equal(request.url, `${environment.R2_ENDPOINT}/tracks/${path}`);
    assert.match(request.headers.get("Authorization"), /Credential=fake-id\/\d{8}\/auto\/s3\/aws4_request/);
    calls.push(request.method);
    if (request.method === "HEAD") return new Response(null, { headers: { "Content-Length": "15" } });
    if (request.method === "GET") return new Response("synthetic track", { headers: { ETag: '"fixture"' } });
    assert.equal(request.headers.get("If-None-Match"), "*");
    assert.equal(await request.text(), "synthetic track");
    return new Response(null, { status: calls.length === 2 ? 200 : 412 });
  } });
  assert.deepEqual(await objects.head(path), { url: `${origin}/${path}`, size: 15 });
  assert.equal(await objects.put(path, Buffer.from("synthetic track"), { contentType: "text/x-ssa" }), true);
  assert.equal(await objects.put(path, Buffer.from("synthetic track"), { contentType: "text/x-ssa" }), false);
  assert.deepEqual(await objects.read(path, 15), { bytes: Buffer.from("synthetic track"), etag: '"fixture"' });
  await assert.rejects(() => objects.read(path, 14), /Storage response exceeds limit/);
  await assert.rejects(() => objects.head("library/../secret"), /Invalid R2 object path/);
  assert.deepEqual(calls, ["HEAD", "PUT", "PUT", "GET", "GET"]);
});

test("source archives require a different signed bucket and never return a public URL", async () => {
  const pathname = `sources/${hash("synthetic source")}.srt`;
  const environment = {
    R2_BUCKET_NAME: "tracks", SOURCE_ARCHIVE_R2_BUCKET_NAME: "private-source",
    SOURCE_ARCHIVE_R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
    SOURCE_ARCHIVE_R2_ACCESS_KEY_ID: "fake-private-id", SOURCE_ARCHIVE_R2_SECRET_ACCESS_KEY: "fake-secret",
  };
  const store = createPrivateSourceStore(environment, { fetcher: async request => {
    assert.equal(request.url, `${environment.SOURCE_ARCHIVE_R2_ENDPOINT}/private-source/${pathname}`);
    assert.match(request.headers.get("Authorization"), /Credential=fake-private-id\//);
    if (request.method === "HEAD") return new Response(null, { headers: { "Content-Length": "16" } });
    assert.equal(request.headers.get("Cache-Control"), "private, no-store");
    assert.equal(request.headers.get("If-None-Match"), "*");
    return new Response();
  } });
  assert.deepEqual(await store.head(pathname), { size: 16 });
  assert.equal(await store.put(pathname, Buffer.from("synthetic source"), { contentType: "text/plain" }), true);
  await assert.rejects(() => store.head(`library/${hash("synthetic source")}.ass`), /Invalid R2 object path/);
  assert.throws(() => createPrivateSourceStore({ ...environment, SOURCE_ARCHIVE_R2_BUCKET_NAME: "tracks" }),
    /separate private R2 bucket/);
});

test("Blob import verifies copied content through the R2 client", async () => {
  const bytes = Buffer.from("Synthetic subtitle");
  const pathname = `library/${hash(bytes)}.ass`;
  const objects = {
    async put(path, contents) {
      assert.equal(path, pathname);
      assert.deepEqual(contents, bytes);
    },
    async read(path, limit) {
      assert.equal(path, pathname);
      assert.equal(limit, 4 * 1024 * 1024);
      return { bytes };
    },
  };
  const result = await importBlobPage({ phase: "objects" }, objects, {
    environment: { BLOB_STORE_ID: storage.storeId },
    listPage: async () => ({ blobs: [{ pathname }], hasMore: false }),
    fetcher: async url => {
      assert.equal(url, `${storage.origin}/${pathname}`);
      return new Response(bytes);
    },
  });
  assert.deepEqual(result, { imported: 1, cursor: null });
});

test("selection summary reads only the aggregate and rejects a stale registry", async () => {
  const published = publication();
  const handler = createSelectionHandler({
    readLibrary: () => assert.fail("summary must not load a publication snapshot"),
    store: () => ({ selectionSummary: async episodes => {
      if (episodes.some(episode => episode.registry !== published.index.registry.sha256)) return null;
      assert.deepEqual(episodes, published.descriptors);
      return { publication: published.publication, total: 2, covered: { eng: 1 } };
    } }),
    readVocabulary: () => assert.fail("summary must not load word documents"),
  });
  const result = response();
  await handler({ method: "POST", body: { mode: "summary", episodes: published.descriptors } }, result);
  assert.deepEqual(result.body, { total: 2, covered: { eng: 1 } });
  assert.equal(result.headers.get("X-Yomiru-Publication"), published.publication);
  const stale = response();
  await handler({ method: "POST", body: { mode: "summary",
    episodes: [{ ...published.descriptors[0], registry: hash("old revision") }] } }, stale);
  assert.equal(stale.statusCode, 409);
});

test("Postgres stages with asset validation, serves an exact union and migrates feedback", {
  skip: !process.env.YOMIRU_TEST_PG_SOCKET,
}, async () => {
  const sql = postgres({ host: process.env.YOMIRU_TEST_PG_SOCKET, database: "postgres",
    max: 2, prepare: false, onnotice: () => {} });
  try {
    const migration = await sql.reserve();
    try { await migration.file(fileURLToPath(new URL("../db/schema.sql", import.meta.url))); }
    finally { migration.release(); }
    const store = createPublicationStore(sql), readLibrary = createDatabaseReader(store);
    const first = publication();
    async function activate(prepared, body = {}) {
      return activateR2Publication(body, prepared.pointer, { origin, publications: store, fetcher: async url => {
        const bytes = prepared.assets.get(new URL(url).pathname);
        return bytes ? new Response(bytes) : new Response(null, { status: 404 });
      } });
    }
    const corrupted = publication();
    corrupted.assets.set(corrupted.index.tracks[0].path, Buffer.from("different"));
    await assert.rejects(() => activate(corrupted), /integrity/);
    assert.equal(await store.current(), null);
    await activate(first);
    assert.equal((await readLibrary()).publication, first.publication);
    const ids = first.descriptors.map(row => row.id);
    const browse = createBrowseHandler({ readLibrary, store: () => store }), browseResult = response();
    await browse({ method: "GET", query: { search: "Ｓ０１Ｅ０２ english", show: "tt1234567" } }, browseResult);
    assert.equal(browseResult.statusCode, 200);
    assert.deepEqual(browseResult.body.rows.map(row => row.id), [ids[1]]);
    assert.deepEqual(await store.tracks(first.publication, "series", ids[0]), [first.index.tracks[0]]);
    assert.deepEqual(await store.selectionSummary(first.descriptors),
      { publication: first.publication, total: 2, covered: { eng: 1 } });
    assert.deepEqual(await store.selectionSummary([first.descriptors[0]]),
      { publication: first.publication, total: 1, covered: { eng: 1 } });
    assert.deepEqual(await store.selectionSummary(), { publication: first.publication,
      episodeCount: 2, total: 2, covered: { eng: 1 } });
    assert.equal(await store.selectionSummary([{ ...first.descriptors[0], revision: hash("stale vocabulary") }]), null);
    assert.equal(await store.selectionSummary([{ ...first.descriptors[0], id: "unknown" }]), null);
    const handler = createSelectionHandler({ readLibrary, store: () => store });
    const study = response(), chunks = [];
    const csv = Object.assign(new Writable({ write(chunk, encoding, next) { chunks.push(chunk); next(); } }),
      { setHeader() {}, status(code) { this.statusCode = code; return this; } });
    await handler({ method: "POST", body: { mode: "study", episodes: first.descriptors } }, study);
    assert.equal(study.statusCode, 200);
    const shared = study.body.words.find(w => w.id === first.shared);
    assert.equal(shared.count, 3);
    assert.deepEqual(shared.meanings, ["to walk"]);
    assert.deepEqual(filterVocabulary(study.body.words, "arukou").map(w => w.id), [first.shared]);
    await handler({ method: "POST", body: { mode: "csv", episodes: first.descriptors } }, csv);
    assert.equal(csv.statusCode, 200);
    const csvText = Buffer.concat(chunks).toString();
    assert.match(csvText, /meaning_eng/);
    assert.doesNotMatch(csvText, /passeio/);
    assert.match(csvText, /meaning unavailable/);

    const updated = publication("to go on foot");
    const stale = publication("old draft");
    await assert.rejects(() => activate(stale), /changed/);
    const expected = { overwrite: true, etag: `"${first.publication}"` };
    const races = await Promise.allSettled([activate(updated, expected), activate(stale, expected)]);
    assert.equal(races.filter(r => r.status === "fulfilled").length, 1);
    const current = await readLibrary();
    assert.notEqual(current.publication, first.publication);
    assert.equal(await store.selectionSummary(first.descriptors), null);
    assert.deepEqual(await store.selectionSummary(),
      { publication: current.publication, episodeCount: 2, total: 2, covered: { eng: 1 } });

    const release = requestRelease({ filename: "Synthetic video.mkv" });
    const { index, catalogue } = first;
    const context = feedbackContext(index, catalogue, "series", ids[0], index.tracks[0].id, release);
    const { group } = context;
    const votes = createDatabaseCompatibility(sql), links = createFeedbackLinks(databaseFeedbackIO(() => sql));
    let state, revision = 0;
    const legacy = createCompatibilityStore({
      read: async () => state ? { state: structuredClone(state), etag: String(revision) } : null,
      write: async (path, next) => { state = structuredClone(next); revision++; return true; },
    });
    await legacy.observe(group, release);
    await legacy.vote(group, release.id, hash("viewer 1"), true);
    const importPage = () => importBlobPage({ phase: "votes" }, null, {
      sql: () => sql, privateIO: { read: async () => ({ state }) },
      environment: { COMPATIBILITY_STORE_ID: "fixture" }, listPage: async ({ prefix }) => ({
        hasMore: false, blobs: [{ pathname: `${prefix}${group.id}.json` }],
      }),
    });
    assert.deepEqual(await importPage(), { imported: 1, cursor: null });
    await importPage();
    const viewer = hash("viewer 1");
    assert.equal(publicGroup(group, await votes.get(group, viewer), viewer).releases[0].myVote, true);
    await Promise.all([
      votes.vote(group, release.id, hash("viewer 1"), false),
      votes.vote(group, release.id, hash("viewer 2"), true),
    ]);
    const stats = publicGroup(group, await votes.get(group, viewer), viewer).releases[0];
    assert.deepEqual([stats.total, stats.works, stats.doesntWork, stats.myVote], [2, 1, 1, false]);
    await links.ensure(context);
    assert.deepEqual(await links.get(context.code), context);
    assert.deepEqual(await links.ensure(context), context);

    let ratingExport;
    const blobRatings = createBlobRatings({
      read: async () => null,
      write: async (path, value) => { ratingExport = value; return true; },
    });
    await blobRatings.save(context.code, viewer, { stars: 4, comment: "Synthetic comment" });
    const importRatings = () => importBlobPage({ phase: "ratings" }, null, {
      sql: () => sql, privateIO: { read: async () => ({ state: ratingExport }) },
      environment: { COMPATIBILITY_STORE_ID: "fixture" }, listPage: async ({ prefix }) => ({
        hasMore: false, blobs: [{ pathname: `${prefix}${context.code}.json` }],
      }),
    });
    assert.deepEqual(await importRatings(), { imported: 1, cursor: null });
    await importRatings();
    const ratings = createDatabaseRatings(sql);
    assert.deepEqual(await ratings.get(context.code, viewer), { stars: 4, comment: "Synthetic comment" });
    assert.equal(await ratings.get(context.code, hash("viewer 2")), null);
    await ratings.save(context.code, viewer, { stars: 5, comment: "" });
    assert.deepEqual(await ratings.get(context.code, viewer), { stars: 5, comment: "" });
  } finally {
    await sql.end({ timeout: 1 });
  }
});
