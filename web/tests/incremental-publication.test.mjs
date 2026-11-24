import assert from "node:assert/strict";
import { decodeStoredAss, hasGzipHeader } from "../lib/ass-storage.mjs";
import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import postgres from "postgres";
import { createSelectionHandler } from "../api/vocabulary-selection.mjs";
import { incrementalAdmin } from "../lib/admin-incremental.mjs";
import { createPublicationStore, servingPublicationStore } from "../lib/database.mjs";
import { createWordReviewStore, reviewNextWord } from "../lib/word-review.mjs";
import { loadPublicationRows } from "../lib/r2-publication.mjs";
import { browseSelection, libraryRows } from "../lib/browse.mjs";
import { readPostgresCatalogue } from "../lib/postgres-catalogue.mjs";
import { readPostgresMastery } from "../lib/postgres-mastery.mjs";
import { vocabularyProgressForWords } from "../src/library-mastery.mjs";
import { readPostgresVocabulary, readVocabularySummary, readVocabularyWords } from "../lib/postgres-vocabulary.mjs";
import { useJmdictMatch } from "../lib/jmdict.mjs";
import { deckPracticeStats, practicePageSize, toPracticeCard } from "../src/practice-deck.mjs";
import { practiceCards, selectionPracticeStats } from "../src/vocabulary-practice.mjs";
import { subtitles } from "../lib/library.mjs";
import { feedbackContext, playbackVersion, renderedId } from "../lib/feedback-links.mjs";
import { uploadEpisode } from "../scripts/upload-episode.mjs";
import { fixture } from "./library-fixture.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value));
const originalWordId = `ja-${hash("the test vocabulary word")}`;
const newEpisode = "tt1234567:1:2";

test("practice pages preserve full-scope mastery and the existing card rules", {
  skip: !process.env.YOMIRU_TEST_PG_SOCKET,
}, async () => {
  const options = { host: process.env.YOMIRU_TEST_PG_SOCKET, database: "postgres", max: 2, prepare: false, onnotice: () => {} };
  const manager = postgres(options);
  const namespace = `practice_test_${process.pid}`;
  await manager`CREATE SCHEMA ${manager(namespace)}`;
  const sql = postgres({ ...options, connection: { search_path: namespace } });
  const revision = hash("practice test"), revised = hash("practice corrected");
  const first = "tt1234567:1:1", second = "tt1234567:1:2", hidden = "tt1234567:1:3";
  const words = Array.from({ length: 30 }, (_, index) => ({ id: `word-${index}`, word: "語", reading: "ことば",
    romaji: `  Koto  Ba${index}\u00a0`, pos: index === 0 ? "助詞/格助詞" : "名詞", count: 2,
    meanings: index === 1 ? ["😺".repeat(51), "Ａ   Definition!", " Alternative\u202fmeaning. "]
      : [`Meaning ${index}`] }));
  words.push({ id: "katakana", word: "ｶﾀｶﾅ", reading: "invalid", romaji: "ka", pos: "名詞", count: 1,
    meanings: ["\u3000カタカナ！  "] }, { id: "unplayable", word: "語", reading: "invalid", romaji: "go",
    pos: "名詞", count: 1, meanings: ["meaning"] });
  try {
    const connection = await sql.reserve();
    try {
      for (const file of ["schema.sql", "incremental.sql", "serving.sql"]) {
        await connection.file(fileURLToPath(new URL(`../db/${file}`, import.meta.url)));
      }
    } finally { connection.release(); }
    await sql`INSERT INTO yomiru_publication VALUES (${revision}, ''::bytea)`;
    for (const video of [first, second, hidden]) {
      await sql`INSERT INTO yomiru_incremental_catalogue (id, show_id, search_text, detail)
        VALUES (${video}, 'tt1234567', '', ${sql.json({ unlisted: video === hidden })})`;
      await sql`INSERT INTO yomiru_incremental_vocabulary (video_id, anchor, descriptor, header)
        VALUES (${video}, '', '{}', '{}')`;
    }
    await sql`INSERT INTO yomiru_incremental_dictionary ${sql(words.map(word => ({ id: word.id,
      detail: sql.json({ ...word, meanings: { eng: word.meanings } }) })), "id", "detail")}`;
    await sql`INSERT INTO yomiru_incremental_occurrence ${sql(words.map((word, index) => ({
      video_id: index === 27 ? second : index === 28 ? hidden : first, word_id: word.id,
      detail: sql.json({ count: word.count }) })), "video_id", "word_id", "detail")}`;
    await sql`INSERT INTO yomiru_incremental_head (baseline, revision, catalogue_revision, serving)
      VALUES (${revision}, ${revision}, ${revision}, true)`;

    const selected = { scope: "titles", publication: revision, episodes: [{ id: first }] };
    const expected = practiceCards(words.filter((_, index) => index !== 27 && index !== 28));
    const byId = new Map(expected.map(card => [card.id, card]));
    const checks = [["word-1", "ことば", "alternative meaning"], ["word-29", "ことば", "previous meaning"],
      ["word-27", "ことば", "meaning 27"], ["unplayable", "invalid", "meaning"], ["word-0", "ことば", "meaning 0"]];
    const page = (after, review = []) => readPostgresVocabulary(sql, { ...selected, mode: "practice-page",
      practice: { after, checks, review } });
    const initial = await page(null, ["word-29", "word-27", "word-0"]);
    assert.equal(initial.total, expected.length);
    assert.equal(initial.cards.length, practicePageSize);
    assert.equal(initial.checked, "21000");
    assert.ok(initial.reviews.every(card => card[0] !== "word-0"));
    const later = await page(initial.next);
    assert.equal(later.next, null);
    const returned = [...initial.cards, ...later.cards].map(toPracticeCard);
    assert.equal(new Set(returned.map(card => card.id)).size, expected.length);
    for (const card of returned) assert.deepEqual(card, byId.get(card.id));
    const membership = await readPostgresVocabulary(sql, { ...selected, mode: "practice-membership", practice: { checks } });
    assert.equal(membership.checked, "21000");
    const now = Date.now();
    const progress = new Map(checks.map(([id, readingKey, meaningKey]) => [id,
      { id, readingKey, meaningKey, score: 100, updatedAt: now, stage: 5, halfLife: 1 }]));
    assert.deepEqual(deckPracticeStats(initial.total, new Map(checks.map(([id], i) => [id, initial.checked[i]])), progress, now),
      selectionPracticeStats(expected, progress, now));

    const all = await readPostgresVocabulary(sql, { scope: "all", publication: revision, mode: "practice-page",
      practice: { after: null, checks, review: [] } });
    assert.equal(all.total, initial.total + 1);
    assert.equal(all.checked, "21200");
    assert.ok((await readPostgresVocabulary(sql, { ...selected, mode: "study" })).words.some(word => word.id === "word-0"));
    assert.ok((await readPostgresVocabulary(sql, { ...selected, mode: "practice" })).words.every(word => word[0] !== "word-0"));

    // The second episode shares a word with the first and adds another. A
    // withdrawn episode and a word with an unusable reading contribute nothing.
    await sql`INSERT INTO yomiru_incremental_occurrence (video_id, word_id, detail)
      VALUES (${second}, 'word-1', '{"count":99}')`;
    const movie = "tt0923811";
    await sql`INSERT INTO yomiru_incremental_catalogue (id, show_id, search_text, detail)
      VALUES (${movie}, ${movie}, '', '{"type":"movie"}')`;
    await sql`INSERT INTO yomiru_incremental_metadata VALUES ('movie', ${movie}, '{}')`;
    await sql`INSERT INTO yomiru_incremental_vocabulary (video_id, anchor, descriptor, header) VALUES (${movie}, '', '{}', '{}')`;
    await sql`INSERT INTO yomiru_incremental_occurrence (video_id, word_id, detail)
      VALUES (${movie}, 'word-1', '{"count":1}')`;
    const masteryRequest = { publication: revision, titles: [first, second, movie, hidden],
      groups: ["tt1234567", "movie:Rebuild of Evangelion"], selection: [first, second] };
    const readMastery = async request => {
      const result = await readPostgresMastery(sql, request);
      return new Map(result.scopes.map(([kind, id, words]) => [`${kind}:${id}`, new Set(words)]));
    };
    const scopes = await readMastery(masteryRequest);
    const episode = new Set(expected.map(card => card.id));
    const group = new Set([...episode, "word-27"]);
    assert.deepEqual(scopes.get(`title:${first}`), episode);
    assert.deepEqual(scopes.get(`title:${second}`), new Set(["word-1", "word-27"]));
    assert.equal(scopes.has(`title:${hidden}`), false);
    assert.deepEqual(scopes.get("group:tt1234567"), group);
    assert.deepEqual(scopes.get("group:movie:Rebuild of Evangelion"), new Set(["word-1"]));
    assert.deepEqual(scopes.get("selection:"), group);
    assert.deepEqual(vocabularyProgressForWords(scopes.get("group:tt1234567"), new Map([["word-1", { lastSeenAt: 0 }]])),
      { introduced: 1, mastered: 0, total: group.size });
    assert.deepEqual((await readMastery({ ...masteryRequest, selection: "all" })).get("selection:"), group);
    const packed = await sql.reserve();
    try {
      await packed.file(fileURLToPath(new URL("../db/practice-postings.sql", import.meta.url)));
      const result = await readPostgresMastery(packed, masteryRequest);
      assert.deepEqual(new Map(result.scopes.map(([kind, id, words]) => [`${kind}:${id}`, new Set(words)])), scopes);
    } finally { packed.release(); }
    await sql.begin(async sql => {
      await sql`UPDATE yomiru_incremental_dictionary SET detail = detail || '{"romaji":""}'::jsonb WHERE id = 'word-1'`;
      await sql`UPDATE yomiru_incremental_head SET revision = ${revised}`;
    });
    assert.equal((await page(null)).valid, false);
    assert.deepEqual(await readPostgresMastery(sql, masteryRequest), { revision: revised, valid: false, scopes: [] });
    const updated = await readPostgresVocabulary(sql, { ...selected, publication: revised, mode: "practice-page",
      practice: { after: null, checks, review: [] } });
    assert.equal(updated.total, initial.total - 1);
    assert.equal(updated.checked, "01000");
  } finally {
    await sql.end();
    await manager`DROP SCHEMA ${manager(namespace)} CASCADE`;
    await manager.end();
  }
});

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
  index.tracks[0].lang = "jpn";
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

test("playback migration adds the canonical ASS and retains the old object and revision", {
  skip: !process.env.YOMIRU_TEST_PG_SOCKET,
}, async () => {
  const namespace = `playback_migration_${process.pid}`;
  const options = { host: process.env.YOMIRU_TEST_PG_SOCKET, database: "postgres", max: 2, onnotice: () => {} };
  const manager = postgres(options);
  await manager`CREATE SCHEMA ${manager(namespace)}`;
  const sql = postgres({ ...options, connection: { search_path: namespace } });
  try {
    const connection = await sql.reserve();
    try {
      for (const file of ["schema.sql", "incremental.sql", "subtitle-uploads.sql"]) {
        await connection.file(fileURLToPath(new URL(`../db/${file}`, import.meta.url)));
      }
    } finally { connection.release(); }
    const revision = "a".repeat(64);
    const { index } = fixture();
    const original = Buffer.from(`[Script Info]
PlayResX: 1440
PlayResY: 1080
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Japanese,Arial,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,20,20,184,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:10.00,0:00:12.00,Japanese,,0,0,0,,Synthetic text.
`);
    const sha256 = hash(original);
    const old = { ...index.tracks[0], sha256, path: `/library/${sha256}.ass`, bytes: original.length };
    const legacyKey = `feedback-tracks/v4/${"e".repeat(64)}.ass`;
    const files = new Map([[old.path.slice(1), original], [legacyKey, original]]);
    const objects = { ...mockStore(files),
      async read(key) { return files.has(key) ? { bytes: decodeStoredAss(files.get(key)) } : null; },
      async head(key) {
        const bytes = files.get(key);
        return bytes ? { size: bytes.length, encoding: hasGzipHeader(bytes) ? "gzip" : null } : null;
      },
      async deleteSubtitle(key) { files.delete(key); },
      async legacyPlaybackKeys() { return [...files.keys()].filter(key => key.startsWith("feedback-tracks/")); },
    };
    await sql`INSERT INTO yomiru_publication (revision, snapshot) VALUES (${revision}, ${Buffer.from("{}")})`;
    await sql`INSERT INTO yomiru_incremental_head (baseline, revision, catalogue_revision, serving)
      VALUES (${revision}, ${revision}, ${revision}, true)`;
    await sql`INSERT INTO yomiru_incremental_track (id, detail) VALUES (${old.id}, ${sql.json(old)})`;
    await sql`INSERT INTO yomiru_incremental_track_video (type, video_id, track_id)
      VALUES (${old.type}, ${old.videoIds[0]}, ${old.id})`;

    const migrate = previous => incrementalAdmin({ action: "migrate-playback-tracks", previous, trackIds: [old.id] }, {
      sql, publicAssets: objects,
    });
    const legacy = previous => incrementalAdmin({ action: "purge-legacy-playback", previous }, { sql, publicAssets: objects });
    await assert.rejects(() => legacy(revision), /Finish migrating/);
    await assert.rejects(() => migrate("f".repeat(64)), /catalogue changed/);
    assert.equal(files.size, 2);
    const result = await migrate(revision);
    assert.equal(result.unchanged, false);
    assert.deepEqual(await migrate(revision), { ...result, unchanged: true });
    const store = await servingPublicationStore(sql);
    const tracks = await store.tracks(result.revision, old.type, old.videoIds[0]);
    assert.deepEqual(tracks.find(track => track.id === old.id), { ...old, superseded: true });
    const replacement = tracks.find(track => track.id === result.tracks[0].id);
    assert.equal(replacement.playbackReady, true);
    const reservations = await sql`SELECT key FROM yomiru_subtitle_upload WHERE expires_at > now()`;
    assert.deepEqual(reservations.map(({ key }) => key), [replacement.path.slice(1)]);
    assert.notEqual(replacement.sha256, sha256);
    assert.equal(decodeStoredAss(files.get(replacement.path.slice(1))).toString(), original.toString()
      .replace("0,0,0,,Synthetic", "0,0,0,,{\\pos(720,896)}Synthetic"));
    assert.deepEqual(files.get(old.path.slice(1)), original);
    assert.deepEqual(subtitles({ tracks }, old.type, old.videoIds[0]).map(t => t.id), [replacement.id]);
    const purge = (trackIds, previous) => incrementalAdmin({ action: "purge-superseded-tracks", previous, trackIds }, {
      sql, publicAssets: objects,
    });
    await assert.rejects(() => purge([replacement.id], result.revision), /requires exact superseded/);
    const removed = await purge([old.id], result.revision);
    assert.deepEqual(removed.keys, [old.path.slice(1)]);
    assert.deepEqual(await purge([old.id], result.revision), { ...removed, unchanged: true });
    assert.equal(files.has(old.path.slice(1)), false);
    assert.equal(files.has(replacement.path.slice(1)), true);
    assert.deepEqual(await store.tracks(removed.revision, old.type, old.videoIds[0]), [replacement]);
    assert.deepEqual(await legacy(removed.revision), { keys: [legacyKey] });
    assert.deepEqual(await legacy(removed.revision), { keys: [] });
  } finally {
    await sql.end();
    await manager`DROP SCHEMA ${manager(namespace)} CASCADE`;
    await manager.end();
  }
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
    const edition = "Evangelion: 2.22 You Can (Not) Advance";
    for (const search of [edition, "Evangelion: 2.0 You Can (Not) Advance"]) {
      const { page } = await readPostgresCatalogue(sql, { search });
      assert.deepEqual(page.rows.map(row => [row.id, row.title]), [["tt0860906", edition]]);
      assert.deepEqual(page.rows, await browse({ search }));
    }
    for (const query of [{}, { show: "tt1234567" }, { search: "other m02" }, { search: "rebuild m02" }, { show: "tt7654321" }]) {
      const optimized = await readPostgresCatalogue(sql, query);
      assert.deepEqual(optimized.page.rows, await store.browse(revision, browseSelection(revision, query), 30));
    }

    const videoId = "tt0814243";
    const movie = fixture([1], { type: "movie", vocabulary: [1] });
    const english = { ...movie.index.tracks[0], videoIds: [videoId] };
    const romaji = { ...english, id: "c".repeat(64), lang: "jpn", sha256: "d".repeat(64), path: `/library/${"d".repeat(64)}.ass` };
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
    await sql`INSERT INTO yomiru_incremental_dictionary (id, detail)
      VALUES (${originalWordId}, ${sql.json({ meanings: { eng: ["to walk"] } })})`;
    await sql`INSERT INTO yomiru_incremental_occurrence (video_id, word_id, detail)
      VALUES (${videoId}, ${originalWordId}, ${sql.json({ count: 1 })})`;
    await sql`INSERT INTO yomiru_incremental_word_coverage (word_id, titles) VALUES (${originalWordId}, 1)`;
    assert.deepEqual(await store.selectionSummary(), {
      publication: revision, total: 1, covered: { eng: 1 }, episodeCount: 1, movieCount: 1,
    });
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
    const lastTrack = { ...action, previous: retired.revision, trackIds: [romaji.id] };
    await assert.rejects(admin(lastTrack), /discoverable movie track/);
    const withdrawn = await admin({ ...lastTrack, action: "withdraw-movie-tracks" });
    const hidden = await store.tracks(withdrawn.revision, "movie", videoId);
    assert.deepEqual(subtitles({ tracks: hidden }, "movie", videoId), []);
    assert.equal(lookup(hidden).code, oldLink.code);
    assert.deepEqual(await store.browse(withdrawn.revision, browseSelection(withdrawn.revision, {
      show: "movie:One Piece Movies",
    }), 10), []);
    assert.deepEqual((await store.documents(withdrawn.revision, [videoId])).get(videoId),
      { ...vocabBefore.get(videoId), registry: withdrawn.revision });
    assert.deepEqual(await store.selectionSummary(), {
      publication: withdrawn.revision, total: 0, covered: {}, episodeCount: 0,
    });
    assert.equal(await store.selectionSummary([{ id: videoId, revision: vocabulary.sha256, registry: withdrawn.revision }]), null);
    const purge = { action: "purge-retired-movie-romaji", videoId, trackId: romaji.id, previous: withdrawn.revision };
    await assert.rejects(admin(purge), /Publish the English romaji replacement/);
    const replacement = { ...english, id: "e".repeat(64) };
    await sql`INSERT INTO yomiru_incremental_track (id, detail) VALUES (${replacement.id}, ${sql.json(replacement)})`;
    await sql`INSERT INTO yomiru_incremental_track_video (type, video_id, track_id) VALUES ('movie', ${videoId}, ${replacement.id})`;
    const retiredLink = feedbackContext({ tracks: hidden }, { shows: {} }, "movie", videoId, romaji.id, { id: "exact-test-release" });
    for (const link of [oldLink, retiredLink]) {
      await sql`INSERT INTO yomiru_feedback_link (code, detail) VALUES (${link.code}, ${sql.json(link)})`;
    }
    await assert.rejects(admin({ ...purge, trackId: english.id }), /retired standalone romaji/);
    await sql`UPDATE yomiru_incremental_track SET detail = ${sql.json({ ...replacement, path: romaji.path })} WHERE id = ${replacement.id}`;
    await assert.rejects(admin(purge), /referenced by another track/);
    await sql`UPDATE yomiru_incremental_track SET detail = ${sql.json(replacement)} WHERE id = ${replacement.id}`;
    const removed = new Set();
    const publicAssets = { deleteSubtitle: async key => { removed.add(key); } };
    await assert.rejects(incrementalAdmin(purge, { sql, publicAssets: {
      deleteSubtitle: async () => { throw new Error("simulated unavailable storage"); },
    } }), /simulated unavailable storage/);
    const result = await incrementalAdmin(purge, { sql, publicAssets });
    assert(result.unchanged);
    assert.equal(result.assets.length, 4);
    assert.deepEqual([...removed].sort(), [...result.assets].sort());
    assert(removed.has(romaji.path.slice(1)));
    assert(removed.has(`feedback-tracks/v${playbackVersion}/${renderedId(romaji.id, retiredLink.code)}.ass`));
    assert.deepEqual((await store.tracks(result.revision, "movie", videoId)).map(track => track.id), [english.id, replacement.id]);
    assert.deepEqual((await sql`SELECT code FROM yomiru_feedback_link`).map(row => row.code), [oldLink.code]);
    assert.deepEqual((await store.documents(result.revision, [videoId])).get(videoId),
      { ...vocabBefore.get(videoId), registry: result.revision });
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
  const reviewId = "d".repeat(64);
  const conflicts = [{ cue: "c00001", wordId: originalWordId, reason: "missing-practice-card" }];
  let verifiedPrivate = false;
  let checkResult = conflicts;
  let activations = 0;
  let uploads = 0;
  const admin = async request => {
    const action = request.incremental?.action;
    if (action === "state") return { state: { serving: true, revision: "b".repeat(64), catalogueRevision: "c".repeat(64) } };
    if (action === "private-object") {
      assert.deepEqual(Buffer.from(request.incremental.content, "base64"), original);
      verifiedPrivate = true;
      return { sha256: originalHash };
    }
    assert(verifiedPrivate);
    if (action === "preflight-episode") {
      assert.equal(request.incremental.reviewId, reviewId);
      assert.deepEqual(request.incremental.pointer, staged.publicBundle.pointer);
      return { checked: true, previous: request.incremental.previous, reviewId, snapshot: sha256,
        conflicts: checkResult };
    }
    if (action === "publish") {
      activations += 1;
      assert.equal(request.incremental.previous, "c".repeat(64));
      assert.deepEqual(request.incremental.manifest, staged.manifest);
      return published;
    }
    uploads += 1;
    assert(!Buffer.from(request.content, "base64").equals(original));
    return { sha256: request.path.split("/").at(-1).split(".")[0] };
  };
  assert.deepEqual(await uploadEpisode(staged, admin), published);
  assert.equal((await uploadEpisode(staged, admin, { reviewId })).conflicts, conflicts);
  assert.equal(activations, 1);
  checkResult = [];
  assert.equal((await uploadEpisode(staged, admin, { reviewId, preflight: true })).checked, true);
  assert.equal(activations, 1);
  assert.deepEqual(await uploadEpisode(staged, admin, { reviewId }), published);
  assert.equal(activations, 2);
  const saved = new Map([...staged.publicBundle.assets, [staged.publicBundle.pointer.path, snapshot]]);
  const previousUploads = uploads;
  const readPublicObject = async pathname => saved.get(pathname);
  assert.equal((await uploadEpisode(staged, admin, { reviewId, preflight: true, readPublicObject })).checked, true);
  assert.equal(uploads, previousUploads + 1);
  await assert.rejects(uploadEpisode(staged, admin, { reviewId, preflight: true,
    readPublicObject: async () => Buffer.from("changed bytes") }), /does not match the staged bytes/);
  assert.equal(uploads, previousUploads + 1);
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
    await assert.rejects(() => incrementalAdmin(request, { sql, privateAssets: () => mockStore(privateFiles),
      publicAssets: { ...mockStore(originals), async head() { return null; } },
    }), /staged subtitle disappeared/);
    assert.equal(await store.current(), revision);
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
    const conjugated = structuredClone(seedRow);
    conjugated.detail.jmdictSenses[0].verbClasses = ["v5k"];
    assert.deepEqual(await execute({ action: "seed-jmdict", rows: [conjugated] }), { inserted: 0 });
    assert.deepEqual(await execute({ action: "seed-jmdict", rows: [conjugated] }), { inserted: 0 });
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
    const episodeDrill = await readPostgresVocabulary(sql, {
      scope: "titles", publication: latest, mode: "conjugation", episodes: [{ id: newEpisode }],
    });
    assert.equal(episodeDrill.valid, true);
    assert.deepEqual(episodeDrill.verbs.map(verb => verb.id), [originalWordId]);
    assert.equal(episodeDrill.verbs[0].verbGroup, "godan");
    assert.equal(episodeDrill.verbs[0].forms.find(form => form.id === "polite-past-negative").written, "歩きませんでした");
    const formReview = await readPostgresVocabulary(sql, {
      scope: "all", publication: latest, mode: "conjugation-review", wordIds: [originalWordId, seededId],
    });
    assert.deepEqual(formReview.verbs, episodeDrill.verbs.map(verb => ({ ...verb, count: 0 })));
    assert.deepEqual(await store.tracks(latest, "series", oldId), previousTracks);
    const selectionResponse = {
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; },
    };
    const selectVocabulary = createSelectionHandler({ store: () => store, readLibrary: () => store.library() });
    await selectVocabulary({ method: "POST", body: { scope: "all", mode: "study", publication: latest } }, selectionResponse);
    assert.equal(selectionResponse.statusCode, 200);
    assert.deepEqual(selectionResponse.body.words.map(({ id, meanings }) => [id, meanings]),
      [[originalWordId, ["to walk"]]]);
    const servingRequest = { scope: "all", publication: latest, mode: "page",
      page: { query: "", category: "", offset: 0 } };
    const fullPage = await readVocabularyWords(sql, servingRequest, true);
    assert.equal(fullPage.nextOffset, null);
    assert.deepEqual(fullPage.words.map(({ id, meanings }) => [id, meanings]), [[originalWordId, ["to walk"]]]);
    const verb = { ...servingRequest, page: { ...servingRequest.page, category: "Verb" },
      sort: { column: "meaning", direction: "ascending" } };
    assert.deepEqual((await readVocabularyWords(sql, verb, true)).words, fullPage.words);
    assert.deepEqual((await readVocabularyWords(sql, { ...verb, page: { ...verb.page, query: "walk" } }, true))
      .words.map(({ id }) => id), [originalWordId]);
    const encounteredForm = { ...servingRequest, scope: "titles", episodes: [{ id: newEpisode }],
      page: { ...servingRequest.page, query: "歩い" } };
    assert.deepEqual(await readVocabularyWords(sql, encounteredForm, true),
      await readVocabularyWords(sql, encounteredForm));
    assert.deepEqual((await readVocabularyWords(sql, encounteredForm, true)).words.map(({ id }) => id),
      [originalWordId]);
    for (const useTotals of [true, false]) {
      for (const request of [servingRequest, encounteredForm]) {
        const lookup = await readVocabularyWords(sql, { ...request, page: { ...request.page, index: true } }, useTotals);
        assert.deepEqual(lookup, { revision: latest, valid: true, index: [[originalWordId, true]], nextOffset: null });
        const details = await readVocabularyWords(sql, { ...request,
          page: { ...servingRequest.page, wordIds: [originalWordId, "outside-selection"] },
        }, useTotals);
        assert.deepEqual(details, fullPage);
      }
    }
    const historyRequest = { ...servingRequest,
      page: { ...servingRequest.page, history: true, wordIds: [originalWordId] } };
    const history = await readVocabularyWords(sql, historyRequest, true);
    assert.deepEqual(history, await readVocabularyWords(sql, historyRequest));
    assert.deepEqual(history.words.map(({ id, count, forms }) => [id, count, forms.includes("歩い")]),
      [[originalWordId, fullPage.words[0].count, true]]);
    assert.equal((await readVocabularyWords(sql, { ...servingRequest, publication: revision }, true)).valid, false);
    const { revision: summaryRevision, valid, ...optimizedSummary } = await readVocabularySummary(sql, { scope: "all" }, true);
    assert.equal(summaryRevision, latest);
    assert.equal(valid, true);
    assert.deepEqual(optimizedSummary, await store.selectionSummary());
    const titleScope = { scope: "titles", publication: latest, titles: [newEpisode] };
    const optimizedHandler = createSelectionHandler({ readPostgres: request => readPostgresVocabulary(sql, request) });
    for (const useTotals of [true, false]) {
      const lookup = (historyView, query = "") => readVocabularyWords(sql, {
        ...historyRequest, page: { ...historyRequest.page, historyView, query },
      }, useTotals);
      const preview = (await lookup("index")).words[0];
      assert.equal(preview.count, fullPage.words[0].count);
      assert.equal(preview.verbGroup, episodeDrill.verbs[0].verbGroup);
      assert.deepEqual(preview.forms, []);
      assert.deepEqual((await lookup("details")).words, [{ id: originalWordId, meanings: ["to walk"] }]);
      for (const query of ["歩い", "walk"]) assert.deepEqual((await lookup("matches", query)).matches, [originalWordId]);
      assert.deepEqual((await lookup("matches", "alk")).matches, []);
    }
    await optimizedHandler({ method: "POST", body: { ...historyRequest,
      page: { ...historyRequest.page, historyView: "index", wordIds: [originalWordId, "unseen"] },
    } }, selectionResponse);
    assert.equal(selectionResponse.statusCode, 200);
    assert.deepEqual(selectionResponse.body.words.map(({ id }) => id), [originalWordId]);
    await optimizedHandler({ method: "POST", body: { ...titleScope, mode: "page", page: servingRequest.page } }, selectionResponse);
    assert.equal(selectionResponse.statusCode, 200);
    assert.deepEqual(selectionResponse.body.words.map(({ id, count }) => [id, count]), [[originalWordId, 1]]);
    const csvResponse = handler => {
      const chunks = [];
      const stream = Object.assign(new Writable({ write(chunk, encoding, next) { chunks.push(chunk); next(); } }), {
        setHeader() {}, status(code) { this.statusCode = code; return this; },
      });
      return handler({ method: "POST", body: { scope: "all", publication: latest, mode: "csv" } }, stream)
        .then(() => ({ status: stream.statusCode, payload: Buffer.concat(chunks).toString("utf8") }));
    };
    assert.deepEqual(await csvResponse(optimizedHandler), await csvResponse(selectVocabulary));

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
    const afterCorrection = await readVocabularyWords(sql, { ...servingRequest, publication: corrected.revision }, true);
    assert.deepEqual(afterCorrection.words.map(({ id, count }) => [id, count]), [[originalWordId, 2]]);
    const [saved] = await sql`SELECT anchor, descriptor FROM yomiru_incremental_vocabulary
      WHERE video_id = ${affected}`;
    const priorManifest = JSON.parse(privateFiles.get(correction.manifest.path));
    const priorAnalysis = JSON.parse(gunzipSync(privateFiles.get(priorManifest.analysis.path)));
    const analysis = "unidic-lite-1.0.8-words-v4";
    const cleanAnalysis = archiveObject(privateFiles, "analyses", "json.gz", gzipSync(encode({
      ...priorAnalysis, analysis, wordIds: [], cues: priorAnalysis.cues.map(cue => ({
        ...cue, tokens: cue.tokens.map(([start, end]) => [start, end, null]),
      })),
    })));
    const manifest = archiveObject(privateFiles, "manifests", "json", encode({
      ...priorManifest, analysis: cleanAnalysis,
    }));
    const cleanDocument = encode({ version: 2, anchor: saved.anchor, analysis, words: [] });
    const sha256 = hash(cleanDocument);
    const vocabulary = { ...saved.descriptor, analysis, words: 0,
      sha256, path: `/library/${sha256}.vocabulary.json`, bytes: cleanDocument.length };
    originals.set(vocabulary.path.slice(1), cleanDocument);
    const cleanup = { action: "study-vocabulary", previous: corrected.revision,
      items: [{ manifest, vocabulary, previousVocabulary: saved.descriptor.sha256 }] };
    await assert.rejects(execute({ ...cleanup, items: [{ ...cleanup.items[0], previousVocabulary: revision }] }),
      /Published vocabulary changed/);
    const cleaned = await execute(cleanup);
    assert.equal(cleaned.unchanged, false);
    assert.deepEqual(await execute(cleanup), { revision: cleaned.revision, unchanged: true });
    assert.deepEqual(await store.tracks(cleaned.revision, "series", affected), storedTrack);
    const scope = { scope: "titles", publication: cleaned.revision, episodes: [{ id: affected }] };
    assert.equal((await readPostgresVocabulary(sql, { ...scope, mode: "summary" })).total, 0);
    assert.deepEqual((await readPostgresVocabulary(sql, {
      ...servingRequest, ...scope,
    })).words, []);
    const exportResult = await readPostgresVocabulary(sql, { ...scope, mode: "csv" });
    assert.deepEqual(exportResult.documents.get(affected).words, []);
    assert.deepEqual((await readPostgresVocabulary(sql, { ...scope, mode: "practice" })).words, []);
    const retainedElsewhere = await readVocabularyWords(sql, { ...servingRequest, publication: cleaned.revision }, true);
    assert.deepEqual(retainedElsewhere.words.map(({ id, count }) => [id, count]), [[originalWordId, 1]]);
    const recovery = await execute({ action: "recover-legacy", revision: cleaned.revision });
    assert.equal(recovery.unchanged, false);
    assert.deepEqual(await execute({ action: "recover-legacy", revision: cleaned.revision }),
      { ...recovery, unchanged: true });
    assert.equal((await servingPublicationStore(sql)).incremental, undefined);
    assert.deepEqual(await legacy.tracks(recovery.revision, "series", affected), storedTrack);
    const retained = (await legacy.documents(recovery.revision, [newEpisode])).get(newEpisode).words;
    assert.deepEqual(retained.map(word => [word.id, word.meanings.eng]), [[originalWordId, ["to walk"]]]);
  } finally {
    await sql.end();
    await manager`DROP SCHEMA ${manager(namespace)} CASCADE`;
    await manager.end();
  }
});
