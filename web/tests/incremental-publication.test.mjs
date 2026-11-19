import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import postgres from "postgres";
import { incrementalAdmin } from "../lib/admin-incremental.mjs";
import { createPublicationStore, servingPublicationStore } from "../lib/database.mjs";
import { createWordReviewStore, reviewNextWord } from "../lib/word-review.mjs";
import { loadPublicationRows } from "../lib/r2-publication.mjs";
import { browseSelection, libraryRows } from "../lib/browse.mjs";
import { useJmdictMatch } from "../lib/jmdict.mjs";
import { subtitles } from "../lib/library.mjs";
import { feedbackContext } from "../lib/feedback-links.mjs";
import { uploadEpisode } from "../scripts/upload-episode.mjs";
import { fixture } from "./library-fixture.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value));
const originalWordId = `ja-${hash("the test vocabulary word")}`;
const newEpisode = "tt1234567:1:2";

function archiveObject(files, folder, suffix, bytes) {
  const sha256 = hash(bytes);
  const path = `${folder}/${sha256}.${suffix}`;
  files.set(path, bytes);
  return { path, sha256, bytes: bytes.length };
}

function incrementalFixture(publicFiles, privateFiles, episode = 2, lexical = {}, analyzedId) {
  const { index, catalogue, assets } = fixture([episode], { vocabulary: [episode] });
  const [videoId] = index.tracks[0].videoIds;
  catalogue.shows.tt1234567.videos = [{ id: videoId, season: 1, episode, title: "Synthetic new episode" }];
  const cue = { end: 2000, id: "c00001", japanese: "歩いた。", start: 1000 };
  const anchor = hash(encode([cue]));
  index.tracks[0].anchor = anchor;
  const wordId = lexical.id || originalWordId;
  const document = encode({ version: 1, anchor, analysis: "test", dictionary: null,
    words: [{ id: wordId, word: "歩く", reading: "あるく", romaji: "aruku", pos: "動詞/一般",
      aliases: ["歩く"], meanings: {}, count: 1, forms: ["歩い"],
      examples: [{ cue: cue.id, start: cue.start, japanese: cue.japanese }], ...lexical }] });
  const sha = hash(document);
  const descriptor = { anchor, videoIds: [videoId], words: 1,
    sha256: sha, path: `/library/${sha}.vocabulary.json`, bytes: document.length };
  index.vocabulary = [descriptor];
  publicFiles.set(descriptor.path.slice(1), document);
  for (const track of index.tracks) publicFiles.set(track.path.slice(1), assets.get(track.path));
  const snapshot = encode({ version: 1, index, catalogue });
  const sha256 = hash(snapshot), path = `/library/snapshots/${sha256}.json`;
  publicFiles.set(path.slice(1), snapshot);
  const original = archiveObject(privateFiles, "sources", "srt",
    Buffer.from("1\n00:00:01,000 --> 00:00:02,000\n歩いた。\n"));
  const analysis = archiveObject(privateFiles, "analyses", "json.gz", gzipSync(encode({
    version: 1, anchor, analysis: "test", offsets: "unicode-codepoints", wordIds: [analyzedId || wordId],
    cues: [{ id: cue.id, start: cue.start, end: cue.end, text: cue.japanese, tokens: [[0, 2, 0], [2, 4, null]] }],
  })));
  const manifest = archiveObject(privateFiles, "manifests", "json", encode({
    version: 1, anchor, original, analysis, excludedMusic: false,
  }));
  return { action: "publish", pointer: { version: 1, path, sha256 }, manifest };
}

const mockStore = files => ({
  async read(path) { return files.has(path) ? { bytes: files.get(path) } : null; },
  async head(path) { return files.has(path) ? { size: files.get(path).length } : null; },
  async put(path, data) { if (files.has(path)) return false; files.set(path, data); return true; },
});

test("incremental browsing sequences stored films before filtering and paging", {
  skip: !process.env.YOMIRU_TEST_PG_SOCKET,
}, async () => {
  const namespace = `incremental_movie_browse_${process.pid}`;
  const options = { host: process.env.YOMIRU_TEST_PG_SOCKET, database: "postgres", max: 2, onnotice: () => {} };
  const manager = postgres(options);
  await manager`CREATE SCHEMA ${manager(namespace)}`;
  const sql = postgres({ ...options, connection: { search_path: namespace } });
  try {
    const connection = await sql.reserve();
    try {
      await connection.file(fileURLToPath(new URL("../db/schema.sql", import.meta.url)));
      await connection.file(fileURLToPath(new URL("../db/incremental.sql", import.meta.url)));
    } finally {
      connection.release();
    }
    const revision = "a".repeat(64);
    await sql`INSERT INTO yomiru_publication (revision, snapshot) VALUES (${revision}, ${Buffer.from("{}")})`;
    await sql`INSERT INTO yomiru_incremental_head (baseline, revision, catalogue_revision, serving)
      VALUES (${revision}, ${revision}, ${revision}, true)`;
    const episodeIds = ["tt1234567:1:1", "tt1234567:1:2"];
    for (const [index, id] of episodeIds.entries()) {
      const row = { id, season: 1, episode: index + 1, show: "Synthetic show", translations: [] };
      await sql`INSERT INTO yomiru_incremental_catalogue (id, show_id, search_text, detail)
        VALUES (${row.id}, 'tt1234567', 'synthetic show', ${sql.json(row)})`;
    }
    for (const [id, title, year] of [
      ["tt7654321", "Recent film", "2020"], ["tt0814243", "Pirate film", "2000"],
      ["tt7654322", "Older film", "1990"], ["tt0860906", "Second film", "2009"],
    ]) {
      const row = { id, type: "movie", show: "Movies", title, year, translations: [] };
      await sql`INSERT INTO yomiru_incremental_metadata (type, id, detail) VALUES ('movie', ${id}, ${sql.json({ id })})`;
      await sql`INSERT INTO yomiru_incremental_catalogue (id, show_id, search_text, detail)
        VALUES (${id}, ${id}, ${title.toLowerCase()}, ${sql.json(row)})`;
    }
    const store = await servingPublicationStore(sql);
    const browse = (query, offset = 0) => store.browse(revision, { ...browseSelection(revision, query), offset }, 3);
    assert.deepEqual((await browse({})).map(row => row.id), [...episodeIds, "tt0860906"]);
    assert.deepEqual((await browse({}, 3)).map(row => [row.id, row.code]),
      [["tt0814243", "M01"], ["tt7654322", "M01"], ["tt7654321", "M02"]]);
    assert.deepEqual((await browse({ show: "tt1234567" })).map(row => row.id), episodeIds);
    assert.equal((await browse({ show: "tt7654321" }))[0].code, "M02");
    assert.deepEqual((await browse({ show: "movie:One Piece Movies" })).map(row => row.id), ["tt0814243"]);
    assert.deepEqual((await browse({ search: "other m02" })).map(row => row.id), ["tt7654321"]);
    assert.deepEqual((await browse({ search: "rebuild m02" })).map(row => row.id), ["tt0860906"]);

    const videoId = "tt0814243";
    const movie = fixture([1], { type: "movie", vocabulary: [1] });
    const english = { ...movie.index.tracks[0], videoIds: [videoId] };
    const romaji = { ...english, id: "c".repeat(64), lang: "jpn" };
    const vocabulary = { ...movie.index.vocabulary[0], videoIds: [videoId] };
    const header = { version: 1, anchor: vocabulary.anchor, analysis: "test" };
    await sql`UPDATE yomiru_incremental_catalogue SET detail = jsonb_set(
      detail, '{translations}', ${sql.json([{ code: "eng", label: "English" }])}) WHERE id = ${videoId}`;
    for (const track of [english, romaji]) {
      await sql`INSERT INTO yomiru_incremental_track (id, detail) VALUES (${track.id}, ${sql.json(track)})`;
      await sql`INSERT INTO yomiru_incremental_track_video (type, video_id, track_id)
        VALUES ('movie', ${videoId}, ${track.id})`;
    }
    await sql`INSERT INTO yomiru_incremental_vocabulary (video_id, anchor, descriptor, header)
      VALUES (${videoId}, ${vocabulary.anchor}, ${sql.json(vocabulary)}, ${sql.json(header)})`;
    const vocabBefore = await store.documents(revision, [videoId]);
    const action = { action: "retire-movie-tracks", previous: revision, videoId, trackIds: [english.id] };
    const admin = request => incrementalAdmin(request, { sql });
    await assert.rejects(admin({ ...action, trackIds: [english.id, romaji.id] }), /discoverable movie track/);
    await assert.rejects(admin({ ...action, videoId: "tt7654321" }), /exclusively to this movie/);
    assert.equal(await store.current(), revision);
    const lookup = tracks => feedbackContext({ tracks }, { shows: {} }, "movie", videoId, english.id, null);
    const oldLink = lookup([english, romaji]);
    const retired = await admin(action);
    assert.equal(retired.unchanged, false);
    assert.deepEqual(await admin(action), { revision: retired.revision, unchanged: true });
    const tracks = await store.tracks(retired.revision, "movie", videoId);
    assert.deepEqual(tracks, [{ ...english, superseded: true }, romaji]);
    assert.deepEqual(subtitles({ tracks }, "movie", videoId).map(track => track.id), [romaji.id]);
    assert.equal(lookup(tracks).code, oldLink.code);
    const vocabularyAfter = (await store.documents(retired.revision, [videoId])).get(videoId);
    assert.deepEqual(vocabularyAfter, { ...vocabBefore.get(videoId), registry: retired.revision });
    const updated = (await store.episodeRows(retired.revision, [videoId])).get(videoId);
    assert.deepEqual(updated.translations, []);
    assert.deepEqual(updated.readingModes.map(({ code }) => code), ["romaji"]);
  } finally {
    await sql.end();
    await manager`DROP SCHEMA ${manager(namespace)} CASCADE`;
    await manager.end();
  }
});

test("the upload client sends original cues only through the private operation", async () => {
  const original = Buffer.from("Synthetic Japanese source bytes");
  const originalHash = hash(original);
  const track = Buffer.from("Synthetic public rendered track");
  const trackHash = hash(track);
  const snapshot = encode({ version: 1 });
  const sha256 = hash(snapshot);
  const staged = {
    archiveAssets: new Map([[`sources/${originalHash}.srt`, original]]),
    publicBundle: { assets: new Map([[`/library/${trackHash}.ass`, track]]), bytes: snapshot,
      pointer: { version: 1, sha256, path: `/library/snapshots/${sha256}.json` } },
    manifest: { sha256: "a".repeat(64) },
  };
  const published = { revision: "b".repeat(64), unchanged: false };
  let verifiedPrivate = false;
  const admin = async request => {
    const action = request.incremental?.action;
    if (action === "state") return { state: { serving: true, revision: "b".repeat(64), catalogueRevision: "c".repeat(64) } };
    if (action === "private-object") {
      assert.deepEqual(Buffer.from(request.incremental.content, "base64"), original);
      verifiedPrivate = true;
      return { sha256: originalHash };
    }
    assert(verifiedPrivate);
    if (action === "publish") {
      assert.equal(request.incremental.previous, "c".repeat(64));
      assert.deepEqual(request.incremental.manifest, staged.manifest);
      return published;
    }
    assert(!Buffer.from(request.content, "base64").equals(original));
    return { sha256: request.path.split("/").at(-1).split(".")[0] };
  };
  assert.deepEqual(await uploadEpisode(staged, admin), published);
});

test("JMdict linking preserves curator-provided meanings on the stable word ID", () => {
  const curated = { id: originalWordId, meanings: { eng: ["walk on foot"] }, meaningStatus: { eng: "curated" } };
  const match = { meanings: ["to walk"], detail: { sources: { eng: [] }, dictionaries: [] } };
  assert.deepEqual(useJmdictMatch(curated, match), curated);
});

test("incremental cutover preserves historical links and publishes, retries and reviews one episode", {
  skip: !process.env.YOMIRU_TEST_PG_SOCKET,
}, async () => {
  const namespace = `incremental_test_${process.pid}`;
  const options = { host: process.env.YOMIRU_TEST_PG_SOCKET, database: "postgres", max: 2, prepare: false, onnotice: () => {} };
  const manager = postgres(options);
  await manager`CREATE SCHEMA ${manager(namespace)}`;
  const sql = postgres({ ...options, connection: { search_path: namespace } });
  try {
    const connection = await sql.reserve();
    try { await connection.file(fileURLToPath(new URL("../db/schema.sql", import.meta.url))); }
    finally { connection.release(); }
    const legacy = createPublicationStore(sql);
    const base = fixture([1], { vocabulary: [1] });
    const revision = base.pointer.sha256;
    const { index, catalogue, assets } = base;
    const rows = await loadPublicationRows(index, pathname => assets.get(pathname));
    await legacy.activate({ revision, expected: null, snapshot: base.bytes, ...rows,
      catalogueRows: libraryRows(index, catalogue), tracks: index.tracks });
    const originals = new Map([...assets].map(([path, data]) => [path.slice(1), data]));
    const privateFiles = new Map();
    const execute = request => incrementalAdmin(request, {
      sql, publicAssets: mockStore(originals), privateAssets: () => mockStore(privateFiles),
    });
    assert.equal((await execute({ action: "bootstrap", revision })).initialized, true);
    assert.equal((await execute({ action: "bootstrap", revision })).initialized, false);
    assert.equal((await servingPublicationStore(sql)).incremental, undefined);
    await assert.rejects(() => incrementalAdmin({ action: "cutover", revision, serving: true }, {
      sql, publicAssets: mockStore(originals),
      privateAssets: () => ({ ...mockStore(privateFiles), async put() { throw new Error("Private bucket disallows writes"); } }),
    }), /disallows writes/);
    assert.equal((await servingPublicationStore(sql)).incremental, undefined);
    await execute({ action: "cutover", revision, serving: true });
    const store = await servingPublicationStore(sql);
    assert.equal(store.incremental, true);
    const oldId = index.tracks[0].videoIds[0];
    const previousTracks = await legacy.tracks(revision, "series", oldId);
    assert.deepEqual(await store.tracks(revision, "series", oldId), previousTracks);
    assert.deepEqual(await store.documents(revision, [oldId]), await legacy.documents(revision, [oldId]));
    assert.equal((await store.library()).publication, revision);
    await assert.rejects(sql`UPDATE yomiru_active SET revision = NULL WHERE singleton`, /Legacy publication is closed/);

    const incomplete = incrementalFixture(originals, privateFiles, 2, {}, `ja-${hash("omitted word")}`);
    await assert.rejects(() => execute({ ...incomplete, previous: revision }), /vocabulary must cover the token analysis/);
    assert.equal(await store.current(), revision);
    const request = { ...incrementalFixture(originals, privateFiles), previous: revision };
    const archiveBytes = privateFiles.get(request.manifest.path);
    privateFiles.set(request.manifest.path, Buffer.from("tampered"));
    await assert.rejects(() => execute(request), /integrity validation/);
    privateFiles.set(request.manifest.path, archiveBytes);
    const guardedArchive = mockStore(privateFiles);
    await assert.rejects(() => incrementalAdmin(request, { sql, publicAssets: mockStore(originals),
      privateAssets: () => ({ ...guardedArchive, async read(path) {
        if (path === request.manifest.path) await execute({ action: "cutover", revision, serving: false });
        return guardedArchive.read(path);
      } }),
    }), /Incremental publishing is paused/);
    await execute({ action: "cutover", revision, serving: true });
    const fresh = await execute(request);
    assert.equal(fresh.unchanged, false);
    assert.deepEqual(await execute(request), { revision: fresh.revision, unchanged: true });
    const divergent = incrementalFixture(originals, privateFiles, 2, { id: `ja-${hash("replacement word")}` });
    await assert.rejects(() => execute({ ...divergent, previous: fresh.revision }), /Reviewed vocabulary correction/);
    const vocabularyBefore = await store.documents(fresh.revision, [newEpisode]);
    // A migrated title starts with vocabulary but no private source receipt.
    await sql`UPDATE yomiru_incremental_vocabulary SET manifest_sha256 = NULL WHERE video_id = ${newEpisode}`;
    const target = await execute({ action: "archive-target", videoId: newEpisode });
    assert.match(target.anchor, /^[a-f0-9]{64}$/);
    await assert.rejects(() => execute({ action: "attach-archive", videoId: newEpisode, manifest: divergent.manifest }),
      /token analysis does not match published vocabulary/);
    const attach = { action: "attach-archive", videoId: newEpisode, manifest: request.manifest };
    assert.deepEqual(await execute(attach), { sha256: request.manifest.sha256, unchanged: false });
    assert.deepEqual(await execute(attach), { sha256: request.manifest.sha256, unchanged: true });
    assert.equal(await store.current(), fresh.revision);
    assert.deepEqual(await store.documents(fresh.revision, [newEpisode]), vocabularyBefore);
    await assert.rejects(() => execute({ action: "cutover", revision: fresh.revision, serving: false }), /Replay incremental changes/);
    assert.deepEqual(await store.tracks(fresh.revision, "series", oldId), previousTracks);
    assert.equal((await store.tracks(fresh.revision, "series", newEpisode)).length, 1);
    assert.equal((await store.selectionSummary()).total, 1);
    assert.deepEqual((await store.selectionSummary()).covered, {});
    assert.equal(JSON.stringify(await store.library()).includes(request.manifest.sha256), false);

    const entryId = 1234000;
    const seededId = `ja-${hash(JSON.stringify(["jmdict", entryId, "あるく"]))}`;
    const provenance = { sha256: hash("synthetic dictionary"), name: "Synthetic dictionary",
      url: "https://example.test/dictionary", copyright: "Test data", license: "CC0",
      licenseUrl: "https://example.test/license" };
    const seedRow = { id: seededId, jmdict_entry_id: entryId, detail: {
      id: seededId, word: "歩く", reading: "あるく", romaji: "", pos: "", aliases: ["歩く"],
      meanings: { eng: ["to walk"] }, meaningStatus: { eng: "dictionary" },
      sources: { eng: [provenance.sha256] }, dictionaries: [provenance],
      jmdictSenses: [{ forms: ["歩く"], pos: ["動詞"], eng: ["to walk"] }],
    } };
    assert.deepEqual(await execute({ action: "seed-jmdict", rows: [seedRow] }), { inserted: 1 });
    assert.deepEqual(await execute({ action: "seed-jmdict", rows: [seedRow] }), { inserted: 0 });
    const review = await reviewNextWord(createWordReviewStore(sql), async messages => {
      const job = JSON.parse(messages[1].content);
      assert.equal(job.word.id, originalWordId);
      assert.deepEqual(job.candidates, [{ entryId, meanings: ["to walk"] }]);
      return JSON.stringify({ outcome: "definition", entryId, reason: "The cue uses the verb for walking.",
        videoId: newEpisode, cue: "c00001", excerpt: "歩いた" });
    });
    assert.equal(review.state, "resolved");
    assert.deepEqual((await store.selectionSummary()).covered, { eng: 1 });
    const latest = await store.current();
    const { words } = (await store.documents(latest, [newEpisode])).get(newEpisode);
    assert.deepEqual(words[0].meanings, { eng: ["to walk"] });
    assert.equal(words[0].id, originalWordId);
    assert.deepEqual(await store.tracks(latest, "series", oldId), previousTracks);

    const badWord = `ja-${hash("synthetic segmentation error")}`;
    const affected = "tt1234567:1:3";
    const proposed = incrementalFixture(originals, privateFiles, 3, {
      id: badWord, word: "歩い", reading: "ほい", pos: "名詞", aliases: ["歩い"],
    });
    const publicationState = (await execute({ action: "state" })).state;
    assert.equal(publicationState.revision, latest);
    assert.equal(publicationState.catalogueRevision, fresh.revision);
    // A dictionary-only revision leaves a prepared subtitle upload valid.
    const published = await execute({ ...proposed, previous: fresh.revision });
    const [journal] = await sql`SELECT previous FROM yomiru_incremental_change WHERE revision = ${published.revision}`;
    assert.equal(journal.previous, latest);
    const flagged = await reviewNextWord(createWordReviewStore(sql), async () => JSON.stringify({
      outcome: "tokenization_error", reason: "The dictionary form is attached to an incomplete token.",
      videoId: affected, cue: "c00001", excerpt: "歩いた",
    }));
    assert.equal(flagged.state, "needs_review");
    const storedTrack = await store.tracks(published.revision, "series", affected);
    const correction = { ...incrementalFixture(originals, privateFiles, 3), action: "correct-vocabulary",
      previous: published.revision, wordId: badWord };
    const corrected = await execute(correction);
    assert.deepEqual(await execute(correction), { revision: corrected.revision, unchanged: true });
    assert.deepEqual(await store.tracks(corrected.revision, "series", affected), storedTrack);
    assert.deepEqual((await store.documents(corrected.revision, [affected])).get(affected).words.map(word => word.id),
      [originalWordId]);
    assert.equal((await store.selectionSummary()).total, 1);
    const recovery = await execute({ action: "recover-legacy", revision: corrected.revision });
    assert.equal(recovery.unchanged, false);
    assert.deepEqual(await execute({ action: "recover-legacy", revision: corrected.revision }),
      { ...recovery, unchanged: true });
    assert.equal((await servingPublicationStore(sql)).incremental, undefined);
    assert.deepEqual(await legacy.tracks(recovery.revision, "series", affected), storedTrack);
    const retained = (await legacy.documents(recovery.revision, [affected])).get(affected).words;
    assert.deepEqual(retained.map(word => [word.id, word.meanings.eng]), [[originalWordId, ["to walk"]]]);
  } finally {
    await sql.end();
    await manager`DROP SCHEMA ${manager(namespace)} CASCADE`;
    await manager.end();
  }
});
