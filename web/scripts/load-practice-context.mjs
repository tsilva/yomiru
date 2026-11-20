import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const [socket, filename] = process.argv.slice(2);
if (!socket?.startsWith("/") || !filename) {
  throw new Error("Usage: node scripts/load-practice-context.mjs /local/postgresql/socket /path/to/practice.json");
}
const { sourceRevision, cues, examples } = JSON.parse(await readFile(resolve(filename), "utf8"));
if (!/^[0-9a-f]{64}$/.test(sourceRevision) || !cues.length || !examples.length) {
  throw new Error("Expected a nonempty practice projection for one source revision");
}
const lengths = new Map(cues.map(([id, hiragana, romaji]) => [id, [[...hiragana].length, [...romaji].length]]));
for (const [id, , , hs, he, rs, re] of examples) {
  if (![hs, he, rs, re].every(Number.isSafeInteger) || !lengths.has(id)
    || hs < 0 || hs >= he || he > lengths.get(id)[0] || rs < 0 || rs >= re || re > lengths.get(id)[1]) {
    throw new Error(`Invalid practice highlight for ${id}`);
  }
}

const sql = postgres({ host: socket, database: "postgres", max: 1, onnotice: () => {} });
try {
  await sql.file(fileURLToPath(new URL("../db/practice-context.sql", import.meta.url)));
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${sourceRevision}, 0))`;
    await tx`DELETE FROM yomiru_practice_cue WHERE source_revision = ${sourceRevision}`;
    await tx`INSERT INTO yomiru_practice_cue ${tx(cues.map(([cue_id, hiragana, romaji]) => ({
      source_revision: sourceRevision, cue_id, hiragana, romaji,
    })))}`;
    await tx`INSERT INTO yomiru_practice_example ${tx(examples.map(([
      cue_id, word_id, gloss_key, hiragana_start, hiragana_end, romaji_start, romaji_end,
    ]) => ({ source_revision: sourceRevision, cue_id, word_id, gloss_key,
      hiragana_start, hiragana_end, romaji_start, romaji_end })))}`;
  });
  console.log(`Loaded ${cues.length} cues and ${examples.length} examples for ${sourceRevision}.`);
} finally {
  await sql.end();
}
