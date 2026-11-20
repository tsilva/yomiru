import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import postgres from "postgres";
import { readingModes } from "../lib/library.mjs";
import { practiceProjectionRows } from "../lib/practice-context.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");

async function insertRows(sql, table, rows, schema = "yomiru_subtitle_corpus") {
  for (let start = 0; start < rows.length; start += 250) {
    await sql`INSERT INTO ${sql(schema)}.${sql(table)} ${sql(rows.slice(start, start + 250))} ON CONFLICT DO NOTHING`;
  }
}

async function importContexts(tx, pack) {
  const titles = pack.titles.map(({ videoId, anchor, sourceRevision }) => ({
    video_id: videoId, anchor, source_revision: sourceRevision, publication: pack.publication,
  }));
  if (titles.length) {
    await tx`INSERT INTO yomiru_practice_context_title ${tx(titles)} ON CONFLICT (video_id) DO UPDATE
      SET anchor=excluded.anchor,source_revision=excluded.source_revision,publication=excluded.publication`;
  }
  for (const context of pack.contexts) {
    const { sourceRevision } = context;
    const { cueRows, exampleRows } = practiceProjectionRows(tx, context);
    await tx`DELETE FROM yomiru_practice_cue WHERE source_revision=${sourceRevision}`;
    await insertRows(tx, "yomiru_practice_cue", cueRows, "public");
    await insertRows(tx, "yomiru_practice_example", exampleRows, "public");
  }
}

async function verifyTracks(sql, publication) {
  const [result] = await sql`SELECT count(*)::int AS tracks,
    count(*) FILTER (WHERE r.bytes = (t.descriptor->>'bytes')::integer
      AND r.sha256=t.descriptor->>'sha256'
      AND r.sha256=encode(sha256(convert_to(r.header||array_to_string(r.events,E'\\n'),'UTF8')),'hex'))::int AS exact
    FROM yomiru_subtitle_corpus.track AS t JOIN yomiru_subtitle_corpus.rendition AS r USING (sha256)
    WHERE t.publication=${publication}`;
  if (!result.tracks || result.tracks !== result.exact) throw new Error("A published track failed regeneration");
  return result;
}

async function importPack(sql, pack) {
  if (pack.version !== 1 || !/^[a-f0-9]{64}$/.test(pack.publication) || !pack.titles.length || !pack.tracks.length) {
    throw new Error("Expected a complete subtitle corpus");
  }
  const connection = await sql.reserve();
  try {
    for (const file of ["subtitle-corpus.sql", "practice-context.sql"]) {
      await connection.file(fileURLToPath(new URL(`../db/${file}`, import.meta.url)));
    }
  } finally { connection.release(); }
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('yomiru-subtitle-corpus', 0))`;
    await tx`INSERT INTO yomiru_subtitle_corpus.publication VALUES (${pack.publication}) ON CONFLICT DO NOTHING`;
    await insertRows(tx, "source", pack.sources.map(source => ({
      id: source.id, anchor: source.anchor, word_ids: tx.array(source.wordIds, 25),
    })));
    for (const source of pack.sources) {
      await insertRows(tx, "source_cue", source.cues.map((cue, index) => ({
        source_revision: source.id, cue_id: cue.id, ordinal: index + 1, start_ms: cue.start, end_ms: cue.end,
        japanese: cue.japanese, reading_source: cue.reading_source, tokens: tx.json(cue.tokens),
      })));
    }
    const titles = new Map(pack.titles.map(row => [row.videoId, row.sourceRevision]));
    await insertRows(tx, "title", pack.titles.map(row => ({
      publication: pack.publication, video_id: row.videoId, source_revision: row.sourceRevision,
    })));
    await insertRows(tx, "translation", pack.translations.map(row => ({
      id: row.id, source_revision: row.sourceRevision, language: row.language,
      provenance: row.provenance, generation: row.generation, track_id: row.trackId,
    })));
    for (const row of pack.translations) {
      await insertRows(tx, "translation_cue", row.cues.map((cue, index) => ({
        translation_id: row.id, ordinal: index + 1, cue_id: cue.id ?? null,
        start_ms: cue.start, end_ms: cue.end, text: cue.text,
      })));
    }
    await insertRows(tx, "choice", pack.choices.map(row => ({
      publication: pack.publication, video_id: row.videoId, source_revision: titles.get(row.videoId),
      language: row.language, translation_id: row.translationId,
    })));
    await insertRows(tx, "rendition", pack.renditions.map(row => ({
      sha256: row.sha256, bytes: row.bytes, header: row.header, events: tx.array(row.events, 25),
    })));
    await insertRows(tx, "track", pack.tracks.map(row => ({
      publication: pack.publication, id: row.descriptor.id, sha256: row.descriptor.sha256,
      translation_id: row.translationId, descriptor: tx.json(row.descriptor),
    })));
    const result = await verifyTracks(tx, pack.publication);
    if (result.tracks !== pack.tracks.length) throw new Error("Track inventory differs from the corpus");
    await importContexts(tx, pack);
  });
  return { publication: pack.publication, titles: pack.titles.length, tracks: pack.tracks.length,
    languageChoices: pack.choices.length, contextExamples: pack.contexts.reduce((n, p) => n + p.examples.length, 0) };
}

async function renderInputs(sql, publication, video, language) {
  return sql`SELECT choice.video_id,choice.language,t.provenance,
    jsonb_build_object('cues',(SELECT jsonb_agg(jsonb_build_object('start',start_ms,'end',end_ms,
      'reading_source',reading_source) ORDER BY ordinal) FROM yomiru_subtitle_corpus.source_cue
      WHERE source_revision=choice.source_revision)) AS source,
    jsonb_build_object('cues',(SELECT jsonb_agg(jsonb_build_object('start',start_ms,'end',end_ms,
      'text',text) ORDER BY ordinal) FROM yomiru_subtitle_corpus.translation_cue
      WHERE translation_id=choice.translation_id)) AS translation
    FROM yomiru_subtitle_corpus.choice AS choice JOIN yomiru_subtitle_corpus.translation AS t
      ON t.id=choice.translation_id WHERE choice.publication=${publication}
    ${video ? sql`AND choice.video_id=${video} AND choice.language=${language}` : sql``}
    ORDER BY choice.video_id,choice.language`;
}

function pythonRender(rows, script, verify) {
  const runner = fileURLToPath(new URL("../../scripts/render-subtitle-corpus.py", import.meta.url));
  const python = fileURLToPath(new URL("../../.venv/bin/python", import.meta.url));
  const input = rows.map(row => JSON.stringify({ source: row.source, translation: row.translation, script })).join("\n");
  return execFileSync(python, [runner, ...(verify ? ["--verify"] : [])], { input, maxBuffer: 8 * 1024 * 1024 });
}

const { positionals: [command], values } = parseArgs({ allowPositionals: true, options: {
  socket: { type: "string" }, database: { type: "string", default: "postgres" }, input: { type: "string" },
  publication: { type: "string" }, track: { type: "string" }, video: { type: "string" },
  language: { type: "string" }, script: { type: "string" }, out: { type: "string" },
} });
if (!values.socket?.startsWith("/") || !["import", "verify", "render"].includes(command)) {
  throw new Error("Use import, verify or render with --socket /path/to/local/postgres/socket");
}
const sql = postgres({ host: values.socket, database: values.database, max: 1, onnotice: () => {} });
try {
  if (command === "import") {
    const pack = JSON.parse(gunzipSync(await readFile(values.input)));
    console.log(JSON.stringify(await importPack(sql, pack)));
  } else if (!/^[a-f0-9]{64}$/.test(values.publication ?? "")) {
    throw new Error("Supply the exact --publication revision");
  } else if (command === "verify") {
    const tracks = await verifyTracks(sql, values.publication);
    const rows = await renderInputs(sql, values.publication);
    if (!rows.length) throw new Error("No canonical title-language inputs");
    const combinations = readingModes.reduce((total, script) => total + Number(pythonRender(rows, script, true)), 0);
    const restored = rows.filter(row => row.provenance === "rendered").length;
    console.log(JSON.stringify({ ...tracks, combinations, languageChoices: rows.length, recoveredFromAss: restored }));
  } else {
    let bytes;
    if (values.track) {
      const [asset] = await sql`SELECT r.sha256,r.bytes,r.header||array_to_string(r.events,E'\\n') AS ass
        FROM yomiru_subtitle_corpus.track AS t JOIN yomiru_subtitle_corpus.rendition AS r USING (sha256)
        WHERE t.publication=${values.publication} AND t.id=${values.track}`;
      bytes = Buffer.from(asset?.ass ?? "", "utf8");
      if (!asset || bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) throw new Error("Track failed integrity check");
    } else {
      if (!values.video || !values.language || !readingModes.includes(values.script)) {
        throw new Error("Supply --track or --video, --language and --script");
      }
      const rows = await renderInputs(sql, values.publication, values.video, values.language);
      if (rows.length !== 1) throw new Error("This title and language are unavailable in the corpus");
      bytes = pythonRender(rows, values.script, false);
    }
    if (values.out) await writeFile(values.out, bytes, { flag: "wx", mode: 0o600 });
    else process.stdout.write(bytes);
  }
} finally {
  await sql.end();
}
