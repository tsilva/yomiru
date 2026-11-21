import assert from "node:assert/strict";
import { test } from "node:test";
import { release, verifyLivePractice, verifyPreparedPractice } from "../scripts/release-episode.mjs";

const videoId = "tt1234567:1:1";
const publication = "d".repeat(64);
const sourceRevision = "a".repeat(64);
const word = "ja-" + "c".repeat(64);
const translationId = "b".repeat(64);
const vocabulary = { words: [{ id: word, word: "猫", reading: "ねこ", romaji: "neko",
  meanings: { eng: ["cat"] }, pos: "名詞", count: 2 }] };
const card = [word, "ねこ", "neko", "cat", "ねこ", "cat", ["cat"], 1, false, "名詞", null, "猫"];
const cueIds = ["c00001", "c00002"];
const target = [word, 0, 2, 0, 4, ["cat", "dog", "rabbit", "horse"], [0, 1]];
const peek = [word, "cat", 0, 2, 0, 4, "猫"];
const source = { id: sourceRevision, cues: cueIds.map((id, index) => ({ id, start: 1000 * index })) };
const practice = { sourceRevision, translationId,
  cues: cueIds.map(id => [id, "ねこ", "Neko", [target.slice(0, 5)], "A cat.", [target]]),
  coverage: Object.fromEntries(cueIds.map(id => [id, { japanese: "猫", spans: [[0, 1, word, "ready"]] }])) };

function livePage(index) {
  return { valid: true, revision: publication, total: 1, playableIds: [word], cards: [card],
    next: index === 0 ? [1, "c00001"] : null,
    phrases: [{ cue: `${sourceRevision}:${cueIds[index]}`, time: 1000 * index,
      kana: "ねこ", romaji: "Neko", translation: "A cat.", targets: [target],
      japanese: "猫", japaneseTargets: [[0, 1]], peeks: [peek] }] };
}

test("completed review is required before staging a release", async () => {
  await assert.rejects(release({ "dry-run": true }), /Choose --prepare-review/);
  await assert.rejects(release({ "prepare-review": "/draft", executor: "/uploader" }), /private draft/);
});

test("full practice replay validates all occurrences and mastery links", async () => {
  assert.equal(verifyPreparedPractice(practice, vocabulary), 2);
  assert.throws(() => verifyPreparedPractice(practice, { words: [] }), /cannot be reproduced/);
  let page = 0;
  const read = async (_, { body }) => {
    assert.deepEqual(JSON.parse(body).practice.after, page === 0 ? undefined : [1, "c00001"]);
    return livePage(page++);
  };
  assert.equal(await verifyLivePractice(videoId, publication, practice, source, read), 2);
  await assert.rejects(verifyLivePractice(videoId, publication, practice, source, async () =>
    ({ ...livePage(0), next: null })), /ended before the last reviewed cue/);
  await assert.rejects(verifyLivePractice(videoId, publication, practice, source, async () =>
    livePage(1)), /differs from the reviewed cue/);
});

test("episode verification catches missing peeks in the compiled and served exercise", async () => {
  const incomplete = structuredClone(practice);
  incomplete.cues[0][3] = [];
  assert.throws(() => verifyPreparedPractice(incomplete, vocabulary), /Missing Practice word peek in c00001/);
  const live = livePage(0);
  live.phrases[0].peeks = [];
  await assert.rejects(verifyLivePractice(videoId, publication, practice, source, async () => live),
    /Missing Practice word peek/);
});

test("live Practice replay reads the publication from the public response header", async t => {
  let page = 0;
  t.mock.method(globalThis, "fetch", async () => {
    const { revision, valid, ...body } = livePage(page++);
    return Response.json(body, { headers: { "X-Yomiru-Publication": revision } });
  });
  assert.equal(await verifyLivePractice(videoId, publication, practice, source), 2);
});

test("activation requires the exact staged review and serves its reviewed Practice", {
  skip: !process.env.YOMIRU_TEST_PG_SOCKET,
}, async t => {
  const previousContext = process.env.YOMIRU_PRACTICE_CONTEXT;
  process.env.YOMIRU_PRACTICE_CONTEXT = "1";
  t.after(() => {
    if (previousContext === undefined) delete process.env.YOMIRU_PRACTICE_CONTEXT;
    else process.env.YOMIRU_PRACTICE_CONTEXT = previousContext;
  });
  const { createHash } = await import("node:crypto");
  const { fileURLToPath } = await import("node:url");
  const { default: postgres } = await import("postgres");
  const { createArchivedPhraseReader, createStoredPhraseReader, readReviewedPracticeTitles } =
    await import("../lib/archived-practice.mjs");
  const { readPostgresCatalogue } = await import("../lib/postgres-catalogue.mjs");
  const { createIncrementalStore } = await import("../lib/incremental-publication.mjs");
  const { readPhrasePracticePage, readPracticeReview } = await import("../lib/postgres-vocabulary.mjs");
  const connection = { host: process.env.YOMIRU_TEST_PG_SOCKET, max: 1, onnotice: () => {} };
  const manager = postgres({ ...connection, database: "postgres" });
  const database = `review_test_${process.pid}`;
  await manager`CREATE DATABASE ${manager(database)}`;
  const sql = postgres({ ...connection, database });
  try {
    for (const schema of ["schema", "incremental", "serving", "practice-context", "subtitle-corpus",
      "episode-corpus-publisher"]) await sql.file(fileURLToPath(new URL(`../db/${schema}.sql`, import.meta.url)));

    const anchor = "e".repeat(64);
    const vocabularyRevision = "f".repeat(64);
    const generation = "1".repeat(64);
    const stagedRevision = "2".repeat(64);
    const reviewId = "3".repeat(64);
    const document = Buffer.from("synthetic subtitle");
    const sha256 = createHash("sha256").update(document).digest("hex");
    const track = { id: "4".repeat(64), generation, anchor, lang: "eng", script: "romaji",
      type: "series", videoIds: [videoId], sha256, path: `/library/${sha256}.ass`, bytes: document.length,
      source: { label: "Synthetic" } };
    const sourceDocument = { ...source, anchor, wordIds: [word], cues: source.cues.map(cue => ({ ...cue,
      end: cue.start + 900, japanese: "猫", reading_source: "猫", tokens: [[0, 1, 0]] })) };
    const title = { videoId, sourceRevision, anchor };
    const packageWithoutReview = { version: 1, publication: stagedRevision, titles: [title], sources: [sourceDocument],
      translations: [{ id: translationId, sourceRevision, provenance: "paired", generation, language: "eng",
        trackId: track.id, cues: sourceDocument.cues.map(({ id, start, end }) => ({ id, start, end, text: "A cat." })) }],
      choices: [{ videoId, language: "eng", translationId }],
      contexts: [{ sourceRevision, examples: [], cues: [] }],
      tracks: [{ descriptor: track, translationId }],
      renditions: [{ sha256, bytes: document.length, header: document.toString(), events: [] }],
    };
    const descriptor = { sha256: vocabularyRevision, anchor };
    const episode = { revision: stagedRevision, tracks: [track], metadata: [],
      catalogue: [{ id: videoId, vocabulary: descriptor, translations: [{ code: "eng", label: "English" }] }],
      source: { anchor, manifest: { sha256: sourceRevision }, original: { sha256: sourceRevision } },
      vocabulary: [{ id: videoId, descriptor,
        header: { anchor }, words: [{ id: word, count: 2 }] }], dictionary: vocabulary.words,
    };
    const releaseReview = { version: 1, videoId, sourceRevision, translationId, reviewId,
      vocabularyRevision, vocabularyDigest: vocabularyRevision, practice: { ...practice, anchor,
        version: 1, prepared: true, kind: "practice-cues", examples: [],
        coverage: Object.fromEntries(cueIds.map(id => [id, { japanese: "猫", spans: [[0, 1, word, "ready"]] }])) } };
    await sql`INSERT INTO yomiru_publication VALUES (${publication}, ${Buffer.from("baseline")})`;
    await sql`INSERT INTO yomiru_incremental_head (baseline, revision, catalogue_revision, serving)
      VALUES (${publication}, ${publication}, ${publication}, true)`;
    const store = createIncrementalStore(sql);
    const storeReview = payload => sql`SELECT yomiru_corpus_publisher.prepare(${sql.json(payload)}) AS receipt`;
    await assert.rejects(store.publishEpisode(episode, publication), /reviewed episode release/);
    assert.equal(await store.current(), publication);
    await assert.rejects(storeReview(packageWithoutReview), /completed subtitle and Practice release review/);
    const mismatched = structuredClone(releaseReview);
    mismatched.practice.cues[1][4] = "An unrelated line.";
    await assert.rejects(storeReview({ ...packageWithoutReview, releaseReview: mismatched }), /do not match/);

    const [{ receipt }] = await storeReview({ ...packageWithoutReview, releaseReview });
    assert.equal(receipt.reviewId, reviewId);
    await storeReview({ ...packageWithoutReview, releaseReview });
    await assert.rejects(store.publishEpisode({ ...episode, tracks: [{ ...track, generation: "5".repeat(64) }] },
      publication), /reviewed episode release/);
    const ambiguous = structuredClone(episode);
    ambiguous.dictionary[0].meanings.eng.push("dog");
    await assert.rejects(store.publishEpisode(ambiguous, publication), /staged Practice dictionary/);
    assert.equal(await store.current(), publication);

    const readArchive = createArchivedPhraseReader(() => assert.fail("unexpected static archive"), {}, createStoredPhraseReader());
    const request = { scope: "titles", episodes: [{ id: videoId }], mode: "practice-page", order: "phrase" };
    const reviewRequest = { scope: "all", mode: "practice-review", publication };
    assert.equal(await readArchive(sql, { ...request, publication }, 1), null);
    assert.deepEqual(await readReviewedPracticeTitles(sql, publication, [videoId]), new Set());
    assert.deepEqual((await readPracticeReview(sql, reviewRequest, readArchive, [])).sources, []);
    const { revision } = await store.publishEpisode(episode, publication);
    assert.equal((await store.publishEpisode(episode, publication)).unchanged, true);
    const served = await readPhrasePracticePage(sql, { ...request, publication: revision,
      requireReviewed: true, practice: { after: null, checks: [] } }, readArchive);
    assert.equal(await verifyLivePractice(videoId, revision, practice, source, async () => served), 2);
    assert.equal((await readPostgresCatalogue(sql, {})).page.rows[0].practiceSupported, true);
    const review = await readPracticeReview(sql, { ...reviewRequest, publication: revision }, readArchive, []);
    assert.deepEqual(review.sources.map(({ id }) => id), [videoId]);
    assert.deepEqual(review.sources[0].phrases.map(phrase => phrase.targets), [[target], [target]]);
    assert.equal(review.next, null);

    await sql`UPDATE yomiru_incremental_vocabulary SET descriptor = jsonb_set(descriptor, '{sha256}',
      to_jsonb(${"6".repeat(64)}::text)) WHERE video_id = ${videoId}`;
    const { page: { rows: [stale] } } = await readPostgresCatalogue(sql, {});
    assert.equal(stale.practiceSupported, undefined);
    assert.ok(stale.translations.some(({ code }) => code === "eng"));
    const unsupported = await readPhrasePracticePage(sql, { ...request, publication: revision,
      requireReviewed: true, practice: { after: null, checks: [] } }, async () => null);
    assert.deepEqual(unsupported, { revision, valid: true, practiceUnsupported: true });
  } finally {
    await sql.end({ timeout: 1 });
    await manager`DROP DATABASE ${manager(database)}`;
    await manager.end({ timeout: 1 });
  }
});
