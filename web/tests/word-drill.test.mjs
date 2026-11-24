import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { readDictionaryRequest, readPostgresDictionary } from "../lib/postgres-dictionary.mjs";
import { buildWordDrill } from "../src/word-drill.mjs";

const publication = "1".repeat(64);
const makeWord = (id, reading, meaning, count = 0, options = {}) =>
  ({ id, root: id, word: reading, reading, meanings: [meaning], count, ...options });

test("Word Drill starts with stars, fills by frequency and offers both directions", () => {
  const starred = makeWord("star", "いく", "to go");
  const frequent = [
    makeWord("a", "くる", "to come", 11),
    makeWord("b", "はしる", "to run", 5),
    makeWord("c", "あるく", "to walk", 8),
    makeWord("d", "いく", "to pass away", 7),
    makeWord("e", "すすむ", "to advance", 6, { meanings: ["to advance", "to go"] }),
  ];
  const round = buildWordDrill([starred], frequent, true);
  assert.deepEqual(round.slice(0, 3).map(question => question.card.id), ["star", "a", "c"]);
  assert.deepEqual(round.slice(0, 2).map(question => question.toKana), [false, true]);
  assert.equal(round[0].choices.length, 4);
  assert.deepEqual(round[0].choices.map(choice => choice.id).sort(), ["a", "b", "c", "star"]);
  assert.equal(new Set(round.map(question => question.card.root)).size, round.length);
});

test("dictionary request bounds ID batches and rejects invalid revisions and offsets", () => {
  const request = { mode: "dictionary", publication };
  assert.ok(readDictionaryRequest({ ...request, ids: ["ja-a"] }));
  assert.equal(readDictionaryRequest({ ...request, ids: ["ja-a", "ja-a"] }), null);
  assert.equal(readDictionaryRequest({ ...request, ids: ["ja-a"], query: "あ" }), null);
  assert.equal(readDictionaryRequest({ ...request, publication: "other" }), null);
  assert.equal(readDictionaryRequest({ ...request, offset: -1 }), null);
});

test("dictionary matches voiced kana and exposes seeded entries without subtitle uses", {
  skip: !process.env.YOMIRU_TEST_PG_SOCKET,
}, async () => {
  const sql = postgres({ host: process.env.YOMIRU_TEST_PG_SOCKET, database: "postgres", max: 1, onnotice: () => {} });
  const schema = `drill_${randomUUID().replaceAll("-", "")}`;
  try {
    await sql`CREATE SCHEMA ${sql(schema)}`;
    await sql`SET search_path TO ${sql(schema)}, public`;
    await sql`CREATE TABLE yomiru_incremental_head(singleton boolean, serving boolean, revision text)`;
    await sql`INSERT INTO yomiru_incremental_head VALUES (true, true, ${publication})`;
    await sql`CREATE TABLE yomiru_incremental_dictionary(id text PRIMARY KEY, jmdict_entry_id bigint, detail jsonb)`;
    await sql`CREATE TABLE yomiru_public_word_total(word_id text PRIMARY KEY, occurrences bigint)`;
    await sql`CREATE TABLE yomiru_public_title_forms(video_id text PRIMARY KEY, forms jsonb)`;
    await sql`CREATE TABLE yomiru_incremental_catalogue(id text PRIMARY KEY, detail jsonb)`;
    const root = { word: "分ける", reading: "わける", meanings: { eng: ["to divide"] } };
    const unseen = { word: "茂る", reading: "しげる", meanings: { eng: ["to grow thickly"] }, aliases: ["しげる"],
      jmdictSenses: [{ pos: ["動詞"], verbClasses: ["v5r"] }] };
    await sql`INSERT INTO yomiru_incremental_dictionary VALUES
      ('visible', 1, ${sql.json(root)}), ('rare', 2, ${sql.json(unseen)})`;
    await sql`INSERT INTO yomiru_public_word_total VALUES ('visible', 12)`;
    await sql`INSERT INTO yomiru_incremental_catalogue VALUES ('sample', '{}')`;
    await sql`INSERT INTO yomiru_public_title_forms VALUES ('sample', '[["visible","forms","わけた"]]'::jsonb)`;
    const request = input => readDictionaryRequest({ mode: "dictionary", publication, ...input });
    const initial = await readPostgresDictionary(sql, request({}));
    assert.deepEqual(initial.words.map(word => word.id), ["visible", "rare"]);
    const result = await readPostgresDictionary(sql, request({ query: "しげる" }));
    assert.deepEqual(result.words.map(({ id, count }) => [id, count]), [["rare", 0]]);
    const byIds = await readPostgresDictionary(sql, request({ ids: ["rare"] }));
    assert.deepEqual(byIds.words.map(word => word.id), ["rare"]);
    const inflection = await readPostgresDictionary(sql, request({ query: "waketa" }));
    assert.equal(inflection.words[0].id, "visible");
    assert.equal((await readPostgresDictionary(sql, request({ publication: "2".repeat(64) }))).valid, false);
  } finally {
    await sql`DROP SCHEMA IF EXISTS ${sql(schema)} CASCADE`;
    await sql.end();
  }
});
