import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { readPostgresVocabulary, readPracticePage } from "../lib/postgres-vocabulary.mjs";

test("packed practice preserves ranks, counts and membership through publications", {
  skip: !process.env.YOMIRU_TEST_PG_SOCKET,
}, async () => {
  const options = { host: process.env.YOMIRU_TEST_PG_SOCKET, database: "postgres", max: 2, prepare: false, onnotice: () => {} };
  const manager = postgres(options);
  const namespace = `postings_test_${process.pid}`;
  await manager`CREATE SCHEMA ${manager(namespace)}`;
  const sql = postgres({ ...options, connection: { search_path: namespace } });
  const first = "tt1234567:1:1", second = "tt1234567:1:2", hidden = "tt1234567:1:3";
  const episodes = [first, second].map(id => ({ id }));
  const revision = "b".repeat(64);
  const checks = [["word-0", "か", "meaning 0"], ["word-1", "か", "old meaning"], ["word-32", "か", "meaning 32"]];
  const query = (after = null) => ({ scope: "titles", publication: revision, episodes, mode: "practice-page",
    practice: { after, checks, review: ["word-0", "word-32"] } });
  const migrate = async (...files) => {
    const connection = await sql.reserve();
    try {
      for (const file of files) await connection.file(fileURLToPath(new URL(`../db/${file}`, import.meta.url)));
    } finally { connection.release(); }
  };
  const parity = async (request = query()) => {
    const packed = await readPracticePage(sql, request);
    assert.deepEqual(packed, await readPracticePage(sql, request, false));
    return packed;
  };
  try {
    await migrate("schema.sql", "incremental.sql", "serving.sql");
    await sql`INSERT INTO yomiru_publication VALUES (${revision}, ''::bytea)`;
    await sql`INSERT INTO yomiru_incremental_head (baseline, revision, catalogue_revision, serving)
      VALUES (${revision}, ${revision}, ${revision}, true)`;
    for (const video of [first, second, hidden]) {
      await sql`INSERT INTO yomiru_incremental_catalogue (id, show_id, search_text, detail)
        VALUES (${video}, 'tt1234567', '', ${sql.json({ unlisted: video === hidden })})`;
      await sql`INSERT INTO yomiru_incremental_vocabulary (video_id, anchor, descriptor, header)
        VALUES (${video}, '', '{}', '{}')`;
    }
    await sql`INSERT INTO yomiru_incremental_dictionary (id, detail)
      SELECT 'word-'||n,jsonb_build_object('word','語','reading','か','romaji','ka','pos',
        CASE WHEN n=0 THEN '助詞' ELSE '名詞' END, 'meanings',jsonb_build_object('eng',jsonb_build_array('meaning '||n)))
      FROM generate_series(0,32) AS n`;
    await sql`INSERT INTO yomiru_incremental_occurrence (video_id,word_id,detail)
      SELECT ${first},'word-'||n,'{"count":7}'::jsonb FROM generate_series(0,31) AS n
      UNION ALL SELECT ${second},'word-0','{"count":2}'
      UNION ALL SELECT ${hidden},'word-32','{"count":9}'`;
    const fallback = await readPostgresVocabulary(sql, query());
    await migrate("practice-postings.sql");
    const initial = await parity();
    assert.deepEqual(initial, fallback);
    assert.equal(initial.total,32);
    assert.equal(initial.checked,"210");
    assert.equal(initial.cards.length,24);
    const next = await parity(query(initial.next));
    assert.equal(next.cards.length,8);
    assert.equal(new Set([...initial.cards,...next.cards].map(row => row[0])).size,32);

    const [{ term_id: originalKey }] = await sql`SELECT term_id FROM yomiru_practice_word_key WHERE word_id = 'word-0'`;
    await sql`UPDATE yomiru_incremental_occurrence SET detail = '{"count":2147483647}' WHERE word_id = 'word-0'`;
    assert.equal((await parity()).cards[0][7],4294967294);
    await sql`UPDATE yomiru_incremental_dictionary SET detail = detail || '{"romaji":""}' WHERE id = 'word-0'`;
    const removed = await parity();
    assert.equal(removed.total,31);
    assert.equal(removed.checked,"010");
    await sql`UPDATE yomiru_incremental_dictionary SET detail = detail || '{"romaji":"ka","pos":"名詞"}' WHERE id = 'word-0'`;
    assert.equal((await parity()).cards[0][8],false);
    const [{ term_id: restoredKey }] = await sql`SELECT term_id FROM yomiru_practice_word_key WHERE word_id = 'word-0'`;
    assert.equal(restoredKey,originalKey);
    await sql`DELETE FROM yomiru_incremental_occurrence WHERE video_id = ${second}`;
    assert.equal((await parity()).cards[0][7],2147483647);
    await migrate("serving.sql", "practice-postings.sql");
    assert.equal((await parity()).total,32);
    assert.equal((await parity({ ...query(), episodes: [{ id: hidden }] })).valid,false);

    await sql`INSERT INTO yomiru_incremental_occurrence (video_id,word_id,detail)
      VALUES (${second},'word-0','{"count":2147483647}')`;
    await sql`INSERT INTO yomiru_incremental_dictionary (id,detail)
      SELECT 'word-'||n,jsonb_build_object('word','語','reading','か','romaji','ka','pos','名詞',
        'meanings',jsonb_build_object('eng',jsonb_build_array('meaning '||n)))
      FROM generate_series(33,79) AS n`;
    await sql`INSERT INTO yomiru_incremental_occurrence (video_id,word_id,detail)
      SELECT ${second},'word-'||n,'{"count":1}'::jsonb FROM generate_series(33,79) AS n`;
    const filler = Array.from({ length:49 }, (_,i) => ({ id:`tt1234567:1:${i+4}` }));
    await sql`INSERT INTO yomiru_incremental_catalogue (id,show_id,search_text,detail)
      SELECT item->>'id','tt1234567','','{}'::jsonb FROM jsonb_array_elements(${sql.json(filler)}::jsonb) AS item`;
    await sql`INSERT INTO yomiru_incremental_vocabulary (video_id,anchor,descriptor,header)
      SELECT item->>'id','','{}'::jsonb,'{}'::jsonb FROM jsonb_array_elements(${sql.json(filler)}::jsonb) AS item`;
    const wide = { ...query(), episodes:[...episodes,...filler.slice(0,48)] };
    await migrate("practice-bands.sql");
    const { continuation,...banded } = await readPracticePage(sql,wide);
    assert.ok(continuation);
    assert.deepEqual(banded,await readPracticePage(sql,wide,false));
    assert.equal(banded.cards[0][7],4294967294);

    const secondPage = await readPracticePage(sql,{ ...wide, practice:{ after:banded.next, checks:[], review:[] } },false);
    const refill = { ...wide, practice:{ after:banded.next, checks:[],
      review:["word-0","word-32","word-79",secondPage.cards[0][0]], continuation } };
    const expected = await readPracticePage(sql,refill,false);
    assert.deepEqual(await readPracticePage(sql,refill),expected);
    assert.equal(expected.reviews[0][7],4294967294);
    assert.deepEqual(expected.reviews.map(row => row[0]),["word-0","word-79"]);
    assert.deepEqual(await readPracticePage(sql,{ ...refill, episodes:[...wide.episodes].reverse() }),expected);
    const forged = JSON.parse(Buffer.from(continuation,"base64url").toString());
    forged[1][0][1] = 123;
    const { continuation:refreshed,...fallbackRefill } = await readPracticePage(sql,{ ...refill, practice:{ ...refill.practice,
      continuation:Buffer.from(JSON.stringify(forged)).toString("base64url") } });
    assert.ok(refreshed);
    assert.deepEqual(fallbackRefill,expected);
    const otherScope = { ...refill, episodes:[episodes[0],...filler] };
    assert.deepEqual(await readPracticePage(sql,otherScope),await readPracticePage(sql,otherScope,false));

    const updatedRevision = "c".repeat(64);
    await sql.begin(async tx => {
      await tx`UPDATE yomiru_incremental_dictionary SET detail = detail || '{"romaji":""}' WHERE id='word-0'`;
      await tx`UPDATE yomiru_incremental_head SET revision=${updatedRevision}`;
    });
    assert.equal((await readPracticePage(sql,refill)).valid,false);
    const current = { ...wide, publication:updatedRevision };
    const { continuation:nextWindow,...updated } = await readPracticePage(sql,current);
    assert.ok(nextWindow);
    assert.deepEqual(updated,await readPracticePage(sql,current,false));
    assert.equal(updated.total,78);
  } finally {
    await sql.end();
    await manager`DROP SCHEMA ${manager(namespace)} CASCADE`;
    await manager.end();
  }
});
