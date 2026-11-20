import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { practiceProjectionRows } from "../lib/practice-context.mjs";

const [socket, filename] = process.argv.slice(2);
if (!socket?.startsWith("/") || !filename) {
  throw new Error("Usage: node scripts/load-practice-context.mjs /local/postgresql/socket /path/to/practice.json");
}
const { sourceRevision, cues, examples } = JSON.parse(await readFile(resolve(filename), "utf8"));
if (!/^[0-9a-f]{64}$/.test(sourceRevision) || !cues.length || !examples.length) {
  throw new Error("Expected a nonempty practice projection for one source revision");
}
const sql = postgres({ host: socket, database: "postgres", max: 1, onnotice: () => {} });
try {
  const { cueRows, exampleRows } = practiceProjectionRows(sql, { sourceRevision, cues, examples });
  await sql.file(fileURLToPath(new URL("../db/practice-context.sql", import.meta.url)));
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${sourceRevision}, 0))`;
    await tx`DELETE FROM yomiru_practice_cue WHERE source_revision = ${sourceRevision}`;
    await tx`INSERT INTO yomiru_practice_cue ${tx(cueRows)}`;
    await tx`INSERT INTO yomiru_practice_example ${tx(exampleRows)}`;
  });
  console.log(`Loaded ${cues.length} cues and ${examples.length} examples for ${sourceRevision}.`);
} finally {
  await sql.end();
}
