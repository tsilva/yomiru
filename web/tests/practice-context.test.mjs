import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import postgres from "postgres";
import { readPublicVocabularyQuery, readSelection } from "../api/vocabulary-selection.mjs";
import { createArchivedPhraseReader, createArchivedPracticeReader } from "../lib/archived-practice.mjs";
import { createRenderedPracticeReader } from "../lib/rendered-practice.mjs";
import { readPhrasePracticePage, readPostgresVocabulary, readPracticePage } from "../lib/postgres-vocabulary.mjs";
import { addLocalPracticeExamples, practiceProjectionRows } from "../lib/practice-context.mjs";
import { readLocalPracticePhrases } from "../lib/practice-phrases.mjs";
import { packPracticeCard, practicePageSize, practicePageVersion, toPracticeCard } from "../src/practice-deck.mjs";
import { gradePracticeCard, practiceCards, presentPracticeCard } from "../src/vocabulary-practice.mjs";
import { nextPhraseQuestion, quizContextSpans } from "../src/vocabulary-quiz.mjs";

test("peeks exclude repeated target words and any span within the highlighted form", () => {
  const example = ["c00001", "いまあるいた。またあるく。", "Ima aruita. Mata aruku.", 2, 6, 4, 10, [
    ["now", "now", 0, 2, 0, 3, "今"],
    ["walk", "to walk", 2, 5, 4, 8],
    ["past", "past tense", 5, 6, 8, 10],
    ["again", "again", 7, 9, 12, 16],
    ["walk", "to walk", 9, 12, 17, 22],
  ]];
  const target = { kana: [2, 6], romaji: [4, 10] };
  assert.deepEqual(quizContextSpans(example, "walk"), [
    { id: "now", meaning: "now", written: "今", kana: [0, 2], romaji: [0, 3] },
    target,
    { id: "again", meaning: "again", written: undefined, kana: [7, 9], romaji: [12, 16] },
  ]);
  assert.deepEqual(quizContextSpans(example.slice(0, 7), "walk"), [target]);
});

test("shared practice URLs accept only small, canonical selections", () => {
  const query = { mode: "practice-page", publication: "a".repeat(64), format: practicePageVersion };
  assert.deepEqual(readPublicVocabularyQuery({ ...query, titles: "tt1234567:1:1,tt1234567:1:2" }).episodes,
    [{ id: "tt1234567:1:1" }, { id: "tt1234567:1:2" }]);
  assert.ok(readPublicVocabularyQuery({ ...query, titles: "tt1", format: "context-v1" }));
  for (const titles of ["tt1,tt1", "tt2,tt1", "tt1,tt2,tt3,tt4,tt5", "tt1,"]) {
    assert.equal(readPublicVocabularyQuery({ ...query, titles }),null);
  }
  assert.equal(readPublicVocabularyQuery({ ...query, titles: "tt1", format: "old" }),null);
});

test("subtitle order accepts only one explicit title", () => {
  const request = { mode: "practice-page", order: "subtitle", publication: "a".repeat(64),
    scope: "titles", titles: ["tt1234567:1:1"] };
  assert.equal(readSelection(request).order, "subtitle");
  assert.equal(readSelection({ ...request, scope: "all", titles: undefined }), null);
  assert.equal(readSelection({ ...request, titles: ["tt1234567:1:1", "tt1234567:1:2"] }), null);
  assert.equal(readSelection({ ...request, mode: "page" }), null);
  assert.equal(readSelection({ ...request, order: "phrase", titles: ["tt2", "tt1"] }).episodes[0].id, "tt2");
  assert.equal(readSelection({ ...request, order: "phrase", scope: "all", titles: undefined }), null);
});

test("translation requests are limited to an exact cue and one title", () => {
  const cue = `${"b".repeat(64)}:c00001`;
  const request = { mode: "practice-translation", scope: "titles", publication: "a".repeat(64),
    titles: ["tt1234567:1:1"], cue };
  assert.equal(readSelection(request).cue, cue);
  assert.equal(readSelection({ ...request, cue: "c00001" }), null);
  assert.equal(readSelection({ ...request, titles: ["tt1", "tt2"] }), null);
  assert.equal(readSelection({ ...request, practice: {} }), null);
});

test("standalone cards preserve written katakana and keep their existing reading key", () => {
  const [card] = practiceCards([{ id: "eraser", word: "消しゴム", reading: "けしごむ",
    romaji: "keshigomu", meanings: ["eraser"], count: 3, pos: "名詞" }]);
  assert.equal(card.kana, "けしゴム");
  assert.equal(card.readingKey, "けしごむ");
  const packed = packPracticeCard(card);
  packed[1] = "けしごむ";
  assert.deepEqual(toPracticeCard([...packed, null, "消しゴム"]), card);
  assert.equal(toPracticeCard([...packed, null, ["消しゴムをつかう。", "消しゴム", 0]]).kana, "けしごむ");
});

test("practice hydrates only selected sources and current glosses", {
  skip: !process.env.YOMIRU_TEST_PG_SOCKET,
}, async () => {
  const options = { host: process.env.YOMIRU_TEST_PG_SOCKET, database: "postgres", max: 1, onnotice: () => {} };
  const admin = postgres(options);
  const schema = `practice_context_${process.pid}`;
  await admin`CREATE SCHEMA ${admin(schema)}`;
  const sql = postgres({ ...options, connection: { search_path: schema } });
  const previous = process.env.YOMIRU_PRACTICE_CONTEXT;
  let corpusCreated = false;
  try {
    for (const file of ["schema.sql", "incremental.sql", "serving.sql", "practice-context.sql"]) {
      await sql.file(fileURLToPath(new URL(`../db/${file}`, import.meta.url)));
    }
    const publication = "a".repeat(64), anchor = "b".repeat(64), pilot = "c".repeat(64), other = "d".repeat(64);
    const first = "tt1234567:1:1";
    const selection = "tt1234567:1:2";
    await sql`INSERT INTO yomiru_publication VALUES (${publication}, ''::bytea)`;
    await sql`INSERT INTO yomiru_incremental_head VALUES (true, ${publication}, ${publication}, ${publication}, true)`;
    await sql`INSERT INTO yomiru_incremental_source_archive VALUES (${anchor}, ${pilot}, '{}'), (${anchor}, ${other}, '{}')`;
    for (const [episode, source] of [[first, pilot], [selection, other]]) {
      await sql`INSERT INTO yomiru_incremental_catalogue (id, show_id, search_text, detail)
        VALUES (${episode}, 'fixture', '', '{}')`;
      await sql`INSERT INTO yomiru_incremental_vocabulary (video_id, anchor, descriptor, header, manifest_sha256)
        VALUES (${episode}, ${anchor}, '{}', '{}', ${source})`;
      await sql`INSERT INTO yomiru_practice_context_title VALUES (${episode}, ${anchor}, ${source}, ${publication})`;
    }
    for (const [id, kana, romaji, meaning] of [["walk", "あるく", "aruku", "to walk"], ["read", "よむ", "yomu", "to read"]]) {
      await sql`INSERT INTO yomiru_incremental_dictionary (id, detail) VALUES (${id}, ${sql.json({
        word: kana, reading: kana, romaji, pos: "動詞", meanings: { eng: [meaning] },
      })})`;
      await sql`INSERT INTO yomiru_incremental_occurrence VALUES (${selection}, ${id}, '{"count":2}')`;
    }
    await sql`INSERT INTO yomiru_practice_cue (source_revision, cue_id, hiragana, romaji) VALUES
      (${pilot}, 'c00001', 'よくあるく。', 'Yoku aruku.'), (${pilot}, 'c00002', 'よくよむ。', 'Yoku yomu.'),
      (${other}, 'c00002', 'またよむ。', 'Mata yomu.')`;
    await sql`INSERT INTO yomiru_incremental_dictionary (id, detail)
      VALUES ('now', '{"word":"今","meanings":{"eng":["now"]}}')`;
    for (const [id, sourceId, reading, form, partOfSpeech, gloss] of [
      ["kyoto", 1, "きょうと", "京都", "名詞", "Kyoto"],
      ["kyoto-alternate", 2, "きょうと", "京都", "名詞", "Kyoto Prefecture"],
      ["other-spelling", 3, "きょうと", "京土", "名詞", "wrong spelling"],
      ["other-reading", 4, "おおさか", "京都", "名詞", "wrong reading"],
      ["other-part-of-speech", 5, "きょうと", "京都", "動詞", "wrong part of speech"],
    ]) {
      await sql`INSERT INTO yomiru_incremental_dictionary (id, jmdict_entry_id, detail)
        VALUES (${id}, ${sourceId}, ${sql.json({ reading,
          jmdictSenses: [{ forms: [form], pos: [partOfSpeech], eng: [gloss] }],
        })})`;
    }
    const namePeeks = [["now", 0, 2, 0, 3], [["京都", "きょうと"], 2, 6, 4, 9], [["大阪", "おおさか"], 7, 11, 13, 18]];
    const kyotoHint = ["kyoto", "Kyoto · Kyoto Prefecture", 2, 6, 4, 9, "京都"];
    const peeks = [...namePeeks, ["walk", 12, 15, 22, 27]];
    const { cueRows } = practiceProjectionRows(sql, { sourceRevision: other, examples: [],
      cues: [["c00001", "いまきょうととおおさかであるく。", "Ima Kyoto to Osaka de aruku.", peeks]] });
    await sql`INSERT INTO yomiru_practice_cue ${sql(cueRows)}`;
    await sql`INSERT INTO yomiru_practice_example VALUES
      (${pilot}, 'c00001', 'walk', 'to walk', 2, 5, 5, 10), (${pilot}, 'c00002', 'read', 'to write', 2, 4, 5, 9),
      (${other}, 'c00001', 'walk', 'to walk', 12, 15, 22, 27),
      (${other}, 'c00002', 'read', 'to write', 2, 4, 5, 9)`;
    const request = { scope: "titles", publication, episodes: [{ id: selection }], practice: { checks: [], review: [] } };
    delete process.env.YOMIRU_PRACTICE_CONTEXT;
    const baseline = await readPracticePage(sql, request, false);
    process.env.YOMIRU_PRACTICE_CONTEXT = "1";
    const page = await readPracticePage(sql, request, false);
    assert.equal(page.total, baseline.total);
    assert.deepEqual(page.cards.map(card => card.slice(0, 10)), baseline.cards.map(card => card.slice(0, 10)));
    const cards = new Map(page.cards.map(value => [value[0], toPracticeCard(value)]));
    const example = [`${other}:c00001`, "いまきょうととおおさかであるく。", "Ima Kyoto to Osaka de aruku.", 12, 15, 22, 27];
    assert.deepEqual(cards.get("walk").examples, [[...example, [["now", "now", 0, 2, 0, 3, "今"], kyotoHint]]]);
    assert.equal(cards.get("read").examples, undefined);
    const local = await addLocalPracticeExamples(sql, baseline, request, pilot);
    assert.deepEqual(local.cards.map(toPracticeCard), page.cards.map(toPracticeCard));
    const staleLocal = await addLocalPracticeExamples(sql, baseline, { ...request, publication: "f".repeat(64) }, pilot);
    assert.ok(staleLocal.cards.every(card => !toPracticeCard(card).examples));
    const legacy = await addLocalPracticeExamples(sql, baseline, { ...request, episodes: [{ id: first }] }, pilot);
    assert.deepEqual(legacy.cards.map(toPracticeCard).find(card => card.id === "walk").examples,
      [[`${pilot}:c00001`, "よくあるく。", "Yoku aruku.", 2, 5, 5, 10]]);
    await sql`UPDATE yomiru_incremental_dictionary SET detail='{"word":"今","meanings":{"eng":["right now"]}}' WHERE id='now'`;
    const corrected = await readPracticePage(sql, request, false);
    const nowHint = ["now", "right now", 0, 2, 0, 3, "今"];
    const correctedExamples = [[...example, [nowHint, kyotoHint]]];
    assert.deepEqual(corrected.cards.map(toPracticeCard).find(card => card.id === "walk").examples, correctedExamples);
    await sql`UPDATE yomiru_incremental_occurrence SET detail = ${sql.json({
      count: 15, forms: ["あるく"], examples: [{ cue: "c00001", start: 100, japanese: "よむ、あるく。" }],
    })} WHERE video_id=${selection} AND word_id='walk'`;
    await sql`UPDATE yomiru_incremental_occurrence SET detail = ${sql.json({
      count: 2, forms: ["よむ"], examples: [{ cue: "c00001", start: 100, offset: 0, japanese: "よむ、あるく。" }],
    })} WHERE video_id=${selection} AND word_id='read'`;
    await sql`INSERT INTO yomiru_practice_example VALUES (${other}, 'c00002', 'walk', 'to walk', 2, 4, 5, 9)`;
    const episode = await readPracticePage(sql, { ...request, order: "subtitle" });
    assert.deepEqual(episode.cards.map(card => card[0]), ["read", "walk"]);
    const [read, walk] = episode.cards.map(toPracticeCard);
    const alternate = [`${other}:c00002`, "またよむ。", "Mata yomu.", 2, 4, 5, 9];
    assert.deepEqual(walk.examples, [...correctedExamples, alternate]);
    assert.equal(read.examples, undefined);
    assert.deepEqual(episode.cards[0].slice(10), [null, null]);
    await sql`INSERT INTO yomiru_practice_example VALUES (${other}, 'c00002', 'read', 'to read', 2, 4, 5, 9)`;
    const later = await readPracticePage(sql, { ...request, order: "subtitle" });
    assert.deepEqual(toPracticeCard(later.cards[0]).examples,
      [[`${other}:c00002`, "またよむ。", "Mata yomu.", 2, 4, 5, 9]]);
    assert.equal(later.timeline, undefined);
    await admin`CREATE SCHEMA yomiru_subtitle_corpus`;
    corpusCreated = true;
    await sql.file(fileURLToPath(new URL("../db/subtitle-corpus.sql", import.meta.url)));
    await sql`INSERT INTO yomiru_subtitle_corpus.source VALUES (${other}, ${anchor}, '{}'), (${pilot}, ${anchor}, '{}')`;
    await sql`INSERT INTO yomiru_subtitle_corpus.source_cue VALUES
      (${other}, 'c00001', 1, 100, 900, 'みどり', 'みどり', '[]'),
      (${other}, 'c00002', 2, 15_000, 16_000, 'かえる', 'かえる', '[]'),
      (${other}, 'c00003', 3, 20_000, 23_000, 'ここまで', 'ここまで', '[]'),
      (${pilot}, 'c00001', 1, 99_000, 100_000, 'いま', 'いま', '[]')`;
    const timed = await readPracticePage(sql, { ...request, order: "subtitle" });
    assert.deepEqual(timed.timeline, { duration: 23_000, source: other,
      cues: { c00001: 100, c00002: 15_000, c00003: 20_000 },
      stops: [[100, "walk", [2, "read"]], [15_000, "read", null]] });
    assert.equal((await readPracticePage(sql, request, false)).timeline, undefined);
    const roster = { cards: timed.cards.map(toPracticeCard), words: [
      { id: "read", forms: ["よむ"], examples: [{ cue: "c00001", start: 100, japanese: "よむ、あるく。" }] },
      { id: "walk", forms: ["あるく"], examples: [{ cue: "c00001", start: 100, japanese: "よむ、あるく。" }] },
    ] };
    const localTimed = await addLocalPracticeExamples(sql, later, { ...request, order: "subtitle" }, undefined,
      new Map(roster.words.map(({ id }) => [id, "c00001"])), roster);
    assert.deepEqual(localTimed.timeline, timed.timeline);
    const justWalk = await readPracticePage(sql, { ...request, order: "subtitle",
      practice: { ...request.practice, after: timed.timeline.stops[0][2] } });
    assert.deepEqual(justWalk.cards.map(card => card[0]), ["walk"]);
    assert.equal(justWalk.timeline, undefined);
    const archiveText = ["いまきょうととおおさかでよむ。", "Ima Kyoto to Osaka de yomu."];
    const archiveHighlight = [12, 14, 22, 26];
    await sql`INSERT INTO yomiru_incremental_dictionary (id, detail)
      VALUES ('again', '{"meanings":{"eng":["again"]}}')`;
    const asset = gzipSync(JSON.stringify({ version: 1, kind: "practice-cues", sourceRevision: other,
      cues: [["c00001", ...archiveText, [...namePeeks, ["read", ...archiveHighlight]]],
        ["c00002", "またよむ。", "Mata yomu.", [["again", 0, 2, 0, 4], ["read", 2, 4, 5, 9]]]],
      examples: [["c00001", "read", "to read", ...archiveHighlight]] }));
    const sha256 = createHash("sha256").update(asset).digest("hex");
    const manifest = { version: 1, sources: { [other]: { sha256, bytes: asset.length } } };
    let archiveReads = 0;
    const addArchive = createArchivedPracticeReader(async (path, limit) => {
      assert.equal(path, `analyses/${sha256}.json.gz`);
      assert.equal(limit, asset.length);
      archiveReads++;
      return { bytes: asset };
    }, manifest);
    const archived = await addArchive(sql, { ...request, order: "subtitle" }, episode);
    assert.deepEqual(toPracticeCard(archived.cards[0]).examples,
      [[`${other}:c00001`, ...archiveText, ...archiveHighlight, [nowHint, kyotoHint]]]);
    assert.equal(archiveReads, 1);
    assert.equal(await addArchive(sql, { ...request, episodes: [{ id: first }] }, episode), episode);
    assert.equal(archiveReads, 1);
    const generation = "e".repeat(64);
    await sql`INSERT INTO yomiru_incremental_track (id, detail)
      VALUES (${generation}, ${sql.json({ generation, lang: "eng" })})`;
    await sql`INSERT INTO yomiru_incremental_track_video VALUES ('series', ${selection}, ${generation})`;
    await sql`INSERT INTO yomiru_subtitle_corpus.publication VALUES (${publication})`;
    await sql`INSERT INTO yomiru_subtitle_corpus.title VALUES (${publication}, ${selection}, ${other})`;
    await sql`INSERT INTO yomiru_subtitle_corpus.translation VALUES
      (${generation}, ${other}, 'eng', 'paired', ${generation}, ${generation})`;
    await sql`INSERT INTO yomiru_subtitle_corpus.choice VALUES (${publication}, ${selection}, ${other}, 'eng', ${generation})`;
    await sql`INSERT INTO yomiru_subtitle_corpus.translation_cue VALUES
      (${generation}, 1, 'c00001', 100, 900, 'I walk in town now.'),
      (${generation}, 2, 'c00002', 15000, 16000, 'I read again.'),
      (${generation}, 4, 'c00003', 20000, 23000, 'I read here.')`;
    const rosterPage = await readPracticePage(sql, { ...request, order: "subtitle" });
    assert.deepEqual(rosterPage.lines, { [`${other}:c00001`]: ["walk"], [`${other}:c00002`]: ["read"] });
    assert.equal(rosterPage.canonicalContext, true);
    const enriched = await addArchive(sql, { ...request, order: "subtitle" }, rosterPage);
    assert.deepEqual(enriched.lines, rosterPage.lines);
    assert.deepEqual(enriched.timeline, rosterPage.timeline);
    const [enrichedRead, enrichedWalk] = enriched.cards.map(toPracticeCard);
    const againHint = ["again", "again", 0, 2, 0, 4, null];
    assert.deepEqual(enrichedRead.examples, [[...alternate, [againHint]]]);
    assert.deepEqual(enrichedWalk.examples, [...correctedExamples,
      [...alternate, [againHint, ["read", "to read", 2, 4, 5, 9, "よむ"]]]]);
    assert.ok(!JSON.stringify(rosterPage).includes("I read again."));
    await sql`INSERT INTO yomiru_practice_example VALUES (${other}, 'c00001', 'read', 'to read', 12, 14, 22, 26)`;
    const sharedCue = await readPracticePage(sql, { ...request, order: "subtitle" });
    assert.deepEqual(sharedCue.lines, { [`${other}:c00001`]: ["read", "walk"] });
    const translationRequest = { ...request, mode: "practice-translation", cue: `${other}:c00002` };
    assert.deepEqual(await readPostgresVocabulary(sql, translationRequest),
      { valid: true, revision: publication, translation: "I read again." });
    const phraseRequest = { ...request, mode: "practice-page", order: "phrase",
      episodes: [{ id: selection }, { id: first }] };
    const phrasePage = await readPostgresVocabulary(sql, phraseRequest);
    assert.deepEqual(phrasePage.phrases.map(({ cue, translation }) => [cue, translation]), [
      [`${other}:c00001`, "I walk in town now."], [`${other}:c00002`, "I read again."],
      [`${pilot}:c00001`, null],
    ]);
    assert.deepEqual(phrasePage.phrases[0].targets, [["walk", 12, 15, 22, 27]]);
    assert.deepEqual(phrasePage.phrases[0].peeks, [nowHint, kyotoHint, ["walk", "to walk", 12, 15, 22, 27, "あるく"]]);
    assert.deepEqual(phrasePage.phrases[1].targets, [["read", 2, 4, 5, 9], ["walk", 2, 4, 5, 9]]);
    assert.equal(phrasePage.phrases[1].time, 15_000);
    const localPhrases = await readLocalPracticePhrases(sql, phraseRequest, phrasePage.cards.map(toPracticeCard));
    assert.deepEqual(localPhrases.phrases.map(({ cue, translation, targets }) => [cue, translation, targets]),
      phrasePage.phrases.map(({ cue, translation, targets }) => [cue, translation, targets]));
    const following = await readPracticePage(sql, { ...phraseRequest, practice: { ...request.practice, after: [2, "c00002"] } });
    assert.deepEqual(following.phrases.map(({ cue }) => cue), [`${pilot}:c00001`]);
    const rebuilt = gzipSync(JSON.stringify({ version: 1, kind: "practice-cues", sourceRevision: other,
      cues: [["c00003", "いまよむ。", "Ima yomu.", [["now", 0, 2, 0, 3], ["read", 2, 4, 4, 8]]]], examples: [] }));
    const size = rebuilt.length;
    const rebuiltSha = createHash("sha256").update(rebuilt).digest("hex");
    const readArchive = createArchivedPhraseReader(async (path, limit) => {
      assert.equal(path, `analyses/${rebuiltSha}.json.gz`);
      assert.equal(limit, size);
      return { bytes: rebuilt };
    }, { version: 1, phrases: { [other]: { bytes: size, sha256: rebuiltSha } } });
    const archivedPage = await readPhrasePracticePage(sql, phraseRequest, readArchive);
    assert.deepEqual(archivedPage.phrases.map(({ cue, translation }) => [cue, translation]),
      [[`${other}:c00003`, "I read here."]]);
    assert.deepEqual(archivedPage.phrases[0].peeks[0], nowHint);
    assert.deepEqual(archivedPage.next, [1, "c00000"]);
    const remainingPage = await readPhrasePracticePage(sql, { ...phraseRequest,
      practice: { ...request.practice, after: archivedPage.next } }, readArchive);
    assert.deepEqual(remainingPage.phrases.map(({ cue }) => cue), [`${pilot}:c00001`]);
    const alternatives = ["I didn't read it", "I didn't hear it", "I didn't open it", "I didn't see it"];
    const prepared = gzipSync(JSON.stringify({ version: 1, kind: "practice-cues", sourceRevision: other,
      prepared: true, examples: [], cues: [["c00003", "よみませんでした。", "Yomimasen deshita.", [],
        "I didn't read it.", [["read", 0, 8, 0, 17, alternatives]]]] }));
    const preparedHash = createHash("sha256").update(prepared).digest("hex");
    const readReviewed = createArchivedPhraseReader(async () => ({ bytes: prepared }),
      { version: 1, phrases: { [other]: { bytes: prepared.length, sha256: preparedHash } } });
    const reviewedPage = await readPhrasePracticePage(sql, { ...phraseRequest, episodes: [{ id: selection }] }, readReviewed);
    assert.equal(reviewedPage.total, 1);
    assert.deepEqual(reviewedPage.playableIds, ["read"]);
    assert.equal(reviewedPage.phrases[0].translation, "I didn't read it.");
    const question = nextPhraseQuestion(reviewedPage.phrases, reviewedPage.cards.map(toPracticeCard));
    assert.equal(question.card.id, "read");
    assert.equal(question.choices.find(choice => choice.id === "read").meaning, alternatives[0]);
    assert.equal(question.example[1].slice(question.example[3], question.example[4]), "よみませんでした");
    assert.equal(question.example[2].slice(question.example[5], question.example[6]), "Yomimasen deshita");
    const { word, event } = presentPracticeCard(question.card, undefined, "appearance", 1000);
    assert.deepEqual([gradePracticeCard(word, event, {
      correct: question.choices.find(choice => choice.meaning === alternatives[0]).id === question.card.id,
      choices: question.choices.length, spaced: true, at: 1100, sessionStartedAt: 1000,
    }).score, word.id], [35, "read"]);
    assert.equal((await readPostgresVocabulary(sql, { ...translationRequest, cue: `${pilot}:c00002` })).translation, null);
    assert.equal((await readPostgresVocabulary(sql, { ...translationRequest, publication: generation })).valid, false);
    await sql`UPDATE yomiru_subtitle_corpus.translation SET provenance='rendered'`;
    await sql`UPDATE yomiru_subtitle_corpus.translation_cue SET cue_id=NULL`;
    assert.equal((await readPostgresVocabulary(sql, translationRequest)).translation, "I read again.");
    await sql`INSERT INTO yomiru_subtitle_corpus.translation_cue VALUES
      (${generation}, 3, NULL, 15000, 16000, 'A different line occupies the same time.')`;
    assert.equal((await readPostgresVocabulary(sql, translationRequest)).translation, null);
    await sql`DELETE FROM yomiru_subtitle_corpus.translation_cue WHERE ordinal=3`;
    await sql`UPDATE yomiru_incremental_track SET detail=detail||'{"superseded":true}'::jsonb`;
    assert.equal((await readPostgresVocabulary(sql, translationRequest)).translation, null);
    // The public database can serve timed cues without a private translation choice.
    const ass = Buffer.from([
      "[Script Info]", "[Events]", "Format: Layer,Start,End,Style,Text",
      "Dialogue: 0,0:00:00.10,0:00:00.90,Japanese,いま あるく。",
      "Dialogue: 0,0:00:00.10,0:00:00.90,English,{\\i1}I walk now, then rest.",
      "Dialogue: 0,0:00:15.00,0:00:16.00,Japanese,またよむ。",
      "Dialogue: 0,0:00:15.00,0:00:16.00,English,I read again.",
      "Dialogue: 0,0:00:15.00,0:00:16.00,English,A different line at the same time.",
    ].join("\n"));
    const digest = createHash("sha256").update(ass).digest("hex");
    const descriptor = { lang: "eng", generation, anchor, sha256: digest, bytes: ass.length,
      path: `/library/${digest}.ass`, script: "romaji" };
    await sql`DELETE FROM yomiru_subtitle_corpus.choice`;
    await sql`UPDATE yomiru_incremental_track SET detail=${sql.json(descriptor)} WHERE id=${generation}`;
    const renderedPage = await readPracticePage(sql, { ...request, order: "subtitle" });
    assert.equal(renderedPage.canonicalContext, true);
    assert.deepEqual(renderedPage.renderedPractice.timings, { [`${other}:c00001`]: [10, 90, ["read", "walk"]] });
    let trackReads = 0;
    const usePublishedTrack = createRenderedPracticeReader(async selected => {
      assert.deepEqual(selected, descriptor);
      trackReads++;
      return ass;
    });
    const playable = await usePublishedTrack({ mode: "practice-page" }, renderedPage);
    assert.deepEqual(playable.lines, { [`${other}:c00001`]: ["read", "walk"] });
    const renderedWithPeeks = await addArchive(sql, { ...request, order: "subtitle" }, playable);
    assert.deepEqual(toPracticeCard(renderedWithPeeks.cards[0]).examples,
      [toPracticeCard(renderedPage.cards[0]).examples[0], ...enrichedRead.examples]);
    const fallback = { ...translationRequest, cue: `${other}:c00001` };
    const translated = await usePublishedTrack(fallback, await readPostgresVocabulary(sql, fallback));
    assert.equal(translated.translation, "I walk now, then rest.");
    const overlap = await usePublishedTrack(translationRequest, await readPostgresVocabulary(sql, translationRequest));
    assert.equal(overlap.translation, null);
    const renderedPhrases = await usePublishedTrack(phraseRequest, await readPostgresVocabulary(sql, phraseRequest));
    assert.equal(renderedPhrases.phrases[0].translation, "I walk now, then rest.");
    assert.equal(renderedPhrases.phrases[1].translation, null);
    assert.equal(trackReads, 1);
    await sql`INSERT INTO yomiru_practice_cue (source_revision, cue_id, hiragana, romaji, word_peeks)
      SELECT ${pilot}, 'c'||lpad(n::text, 5, '0'), 'あるく', 'Aruku', '[["walk",0,3,0,5]]'::jsonb
      FROM generate_series(3, ${practicePageSize + 1}::int) AS number(n)`;
    const firstPage = await readPracticePage(sql, phraseRequest);
    assert.equal(firstPage.phrases.length, practicePageSize);
    const nextPage = await readPracticePage(sql, { ...phraseRequest,
      practice: { ...phraseRequest.practice, after: firstPage.next } });
    assert.equal(new Set([...firstPage.phrases, ...nextPage.phrases].map(({ cue }) => cue)).size, practicePageSize + 2);
    assert.equal(nextPage.phrases.at(-1).cue, `${pilot}:c${String(practicePageSize + 1).padStart(5, "0")}`);
    await sql`DELETE FROM yomiru_practice_example WHERE source_revision=${other} AND cue_id='c00002' AND word_id='walk'`;
    await sql`UPDATE yomiru_practice_context_title SET anchor=${"e".repeat(64)} WHERE video_id=${selection}`;
    const wrongRevision = await readPracticePage(sql, request, false);
    assert.ok(wrongRevision.cards.every(card => !toPracticeCard(card).examples));
    await sql`ALTER TABLE yomiru_practice_cue DROP COLUMN word_peeks`;
    const unmigrated = await addLocalPracticeExamples(sql, baseline, request, pilot);
    assert.deepEqual(unmigrated.cards.map(toPracticeCard).find(card => card.id === "walk").examples, [example]);
  } finally {
    if (previous === undefined) delete process.env.YOMIRU_PRACTICE_CONTEXT;
    else process.env.YOMIRU_PRACTICE_CONTEXT = previous;
    await sql.end();
    try {
      if (corpusCreated) await admin`DROP SCHEMA yomiru_subtitle_corpus CASCADE`;
      await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
    }
    finally { await admin.end(); }
  }
});
