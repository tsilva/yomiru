import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { readPublicVocabularyQuery, readSelection } from "../api/vocabulary-selection.mjs";
import { readPracticePage } from "../lib/postgres-vocabulary.mjs";
import { addLocalPracticeExamples, practiceProjectionRows } from "../lib/practice-context.mjs";
import { packPracticeCard, practicePageVersion, toPracticeCard } from "../src/practice-deck.mjs";
import { practiceCards } from "../src/vocabulary-practice.mjs";
import { nextQuizQuestion, quizContextSpans } from "../src/vocabulary-quiz.mjs";

test("peeks exclude repeated target words and any span within the highlighted form", () => {
  const example = ["c00001", "いまあるいた。またあるく。", "Ima aruita. Mata aruku.", 2, 6, 4, 10, [
    ["now", "now", 0, 2, 0, 3],
    ["walk", "to walk", 2, 5, 4, 8],
    ["past", "past tense", 5, 6, 8, 10],
    ["again", "again", 7, 9, 12, 16],
    ["walk", "to walk", 9, 12, 17, 22],
  ]];
  const target = { kana: [2, 6], romaji: [4, 10] };
  assert.deepEqual(quizContextSpans(example, "walk"), [
    { meaning: "now", kana: [0, 2], romaji: [0, 3] },
    target,
    { meaning: "again", kana: [7, 9], romaji: [12, 16] },
  ]);
  assert.deepEqual(quizContextSpans(example.slice(0, 7), "walk"), [target]);
});

test("shared practice URLs accept only small, canonical selections", () => {
  const query = { mode: "practice-page", publication: "a".repeat(64), format: practicePageVersion };
  assert.deepEqual(readPublicVocabularyQuery({ ...query, titles: "tt1234567:1:1,tt1234567:1:2" }).episodes,
    [{ id: "tt1234567:1:1" }, { id: "tt1234567:1:2" }]);
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
});

test("a scheduled word uses a different context after its previous example", () => {
  const first = ["c00001", "すこしあるく。", "Sukoshi aruku.", 3, 6, 8, 13];
  const second = ["c00002", "よくあるく。", "Yoku aruku.", 2, 5, 5, 10];
  const original = ["c00003", "よく歩く。", "Yoku aruku.", 2, 4, 5, 10];
  const target = toPracticeCard(["walk", "あるく", "aruku", "to walk", "あるく", "to walk",
    ["to walk"], 40, false, "動詞", [first, second, original]]);
  assert.deepEqual(target.examples, [first, second]);
  const cards = [target, ...["read", "drink", "eat"].map((id, index) => toPracticeCard(
    [id, `kana${index}`, id, id, id, id, [id], 1, false, "動詞"]))];
  const now = Date.now();
  const progress = new Map([[target.id, { id: target.id, dueAt: now - 1, lastSeenAt: 0, reviewGap: 0,
    updatedAt: 0, readingKey: target.readingKey, meaningKey: target.meaningKey, stage: 1 }]]);
  const lastPlayed = new Map([[target.id, { turn: 1, correct: true, cue: "c00001" }]]);
  const question = nextQuizQuestion(cards, progress, lastPlayed, 8, now);
  assert.equal(question.card.id, target.id);
  assert.equal(question.example[0], "c00002");
  assert.equal(question.choices.length, 4);
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
      VALUES ('now', '{"meanings":{"eng":["now"]}}')`;
    const peeks = [["now", 0, 2, 0, 3], ["walk", 2, 5, 4, 9]];
    const { cueRows } = practiceProjectionRows(sql, { sourceRevision: other, examples: [],
      cues: [["c00001", "いまあるく。", "Ima aruku.", peeks]] });
    await sql`INSERT INTO yomiru_practice_cue ${sql(cueRows)}`;
    await sql`INSERT INTO yomiru_practice_example VALUES
      (${pilot}, 'c00001', 'walk', 'to walk', 2, 5, 5, 10), (${pilot}, 'c00002', 'read', 'to write', 2, 4, 5, 9),
      (${other}, 'c00001', 'walk', 'to walk', 2, 5, 4, 9),
      (${other}, 'c00002', 'read', 'to write', 2, 4, 5, 9)`;
    const request = { scope: "titles", publication, episodes: [{ id: selection }], practice: { checks: [], review: [] } };
    delete process.env.YOMIRU_PRACTICE_CONTEXT;
    const baseline = await readPracticePage(sql, request, false);
    process.env.YOMIRU_PRACTICE_CONTEXT = "1";
    const page = await readPracticePage(sql, request, false);
    assert.equal(page.total, baseline.total);
    assert.deepEqual(page.cards.map(card => card.slice(0, 10)), baseline.cards.map(card => card.slice(0, 10)));
    const cards = new Map(page.cards.map(value => [value[0], toPracticeCard(value)]));
    const example = [`${other}:c00001`, "いまあるく。", "Ima aruku.", 2, 5, 4, 9];
    assert.deepEqual(cards.get("walk").examples, [[...example, [["now", "now", 0, 2, 0, 3]]]]);
    assert.equal(cards.get("read").examples, undefined);
    const local = await addLocalPracticeExamples(sql, baseline, request, pilot);
    assert.deepEqual(local.cards.map(toPracticeCard), page.cards.map(toPracticeCard));
    const staleLocal = await addLocalPracticeExamples(sql, baseline, { ...request, publication: "f".repeat(64) }, pilot);
    assert.ok(staleLocal.cards.every(card => !toPracticeCard(card).examples));
    const legacy = await addLocalPracticeExamples(sql, baseline, { ...request, episodes: [{ id: first }] }, pilot);
    assert.deepEqual(legacy.cards.map(toPracticeCard).find(card => card.id === "walk").examples,
      [[`${pilot}:c00001`, "よくあるく。", "Yoku aruku.", 2, 5, 5, 10]]);
    await sql`UPDATE yomiru_incremental_dictionary SET detail='{"meanings":{"eng":["right now"]}}' WHERE id='now'`;
    const corrected = await readPracticePage(sql, request, false);
    const correctedExamples = [[...example, [["now", "right now", 0, 2, 0, 3]]]];
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
    assert.deepEqual(walk.examples, correctedExamples);
    assert.equal(read.examples, undefined);
    assert.deepEqual(episode.cards[0].slice(10), [null, null]);
    const justWalk = await readPracticePage(sql, { ...request, order: "subtitle",
      practice: { ...request.practice, after: [2, "read"] } });
    assert.deepEqual(justWalk.cards.map(card => card[0]), ["walk"]);
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
    try { await admin`DROP SCHEMA ${admin(schema)} CASCADE`; }
    finally { await admin.end(); }
  }
});
