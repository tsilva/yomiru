import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { validateRegistry } from "./vocabulary.mjs";

const wordId = /^ja-[a-f0-9]{64}$/;
const english = entry => entry?.meanings?.eng || [];
const maxBatchRows = 2500;
const maxBatchBytes = 3 * 1024 * 1024;

export async function seedJmdictRows(sql, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > maxBatchRows) throw new Error("Invalid JMdict import batch");
  for (const { id, jmdict_entry_id: sourceId, detail } of rows) {
    if (!wordId.test(id) || !Number.isSafeInteger(sourceId) || sourceId < 1
      || detail?.id !== id || typeof detail.reading !== "string" || !detail.reading
      || !Array.isArray(detail.aliases) || !detail.aliases.includes(detail.word)
      || !Array.isArray(detail.jmdictSenses) || !detail.jmdictSenses.length || !english(detail).length
      || detail.meaningStatus?.eng !== "dictionary") throw new Error("Invalid JMdict import row");
    const expected = "ja-" + createHash("sha256")
      .update(JSON.stringify(["jmdict", sourceId, detail.reading])).digest("hex");
    if (id !== expected) throw new Error("JMdict row identity changed");
    validateRegistry({ version: 1, analysis: "jmdict-seed", entries: [detail], dictionaries: detail.dictionaries });
    if (detail.jmdictSenses.some(sense => ![sense?.forms, sense?.pos, sense?.eng]
      .every(values => Array.isArray(values) && values.every(value => typeof value === "string")))) {
      throw new Error("Invalid JMdict sense");
    }
  }
  const insert = rows.map(({ id, jmdict_entry_id, detail }) => ({ id, jmdict_entry_id, detail: sql.json(detail) }));
  const result = await sql`INSERT INTO yomiru_incremental_dictionary ${sql(insert)} ON CONFLICT (id) DO NOTHING`;
  return result.count;
}

export async function importJmdict(input, seed) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  let batch = [], batchBytes = 2, received = 0, inserted = 0;
  for await (const line of lines) {
    if (!line || Buffer.byteLength(line) > 1024 * 1024) throw new Error("Invalid JMdict JSONL row size");
    const row = JSON.parse(line);
    const rowBytes = Buffer.byteLength(JSON.stringify(row)) + 1;
    if (batch.length === maxBatchRows || batchBytes + rowBytes > maxBatchBytes) {
      inserted += await seed(batch);
      batch = [];
      batchBytes = 2;
    }
    batch.push(row);
    batchBytes += rowBytes;
    received++;
  }
  if (batch.length) inserted += await seed(batch);
  if (!received) throw new Error("JMdict input contains no entries");
  return { received, inserted };
}

function matchWord(word, candidates) {
  const forms = [...new Set([word.word, ...(word.aliases || [])])];
  const partOfSpeech = word.pos?.split("/")[0];
  if (!partOfSpeech) return [];
  return candidates.flatMap(({ jmdict_entry_id: sourceId, detail }) => {
    const senses = detail.jmdictSenses.filter(sense => sense.pos.includes(partOfSpeech)
      && sense.forms.some(form => forms.includes(form)));
    const meanings = [...new Set(senses.flatMap(sense => sense.eng))];
    return meanings.length ? [{ sourceId, detail, meanings }] : [];
  });
}

export async function jmdictCandidates(sql, words) {
  const readings = [...new Set(words.map(word => word.reading).filter(Boolean))];
  const byReading = new Map();
  for (let start = 0; start < readings.length; start += 500) {
    const candidates = await sql`SELECT jmdict_entry_id, detail FROM yomiru_incremental_dictionary
      WHERE detail ? 'jmdictSenses' AND detail ->> 'reading' = ANY(${sql.array(readings.slice(start, start + 500), 25)})`;
    for (const candidate of candidates) {
      const { reading } = candidate.detail;
      if (!byReading.has(reading)) byReading.set(reading, []);
      byReading.get(reading).push(candidate);
    }
  }
  return new Map(words.map(word => [word.id, matchWord(word, byReading.get(word.reading) || [])]));
}

export async function matchJmdict(sql, words) {
  const candidates = await jmdictCandidates(sql, words);
  return new Map([...candidates].flatMap(([id, matches]) => matches.length === 1 ? [[id, matches[0]]] : []));
}

export function useJmdictMatch(word, match) {
  if (english(word).length || word.meaningStatus?.eng === "curated") return word;
  return {
    ...word, meanings: { ...word.meanings, eng: match.meanings },
    sources: { ...word.sources, eng: match.detail.sources.eng },
    meaningStatus: { ...word.meaningStatus, eng: "dictionary" },
    dictionaries: [...new Map([...(word.dictionaries || []), ...match.detail.dictionaries]
      .map(source => [source.sha256, source])).values()],
  };
}

export async function recordDictionaryChange(tx, previous, payload) {
  const revision = createHash("sha256").update(JSON.stringify([previous, payload])).digest("hex");
  await tx`INSERT INTO yomiru_incremental_change (revision, previous, payload)
    VALUES (${revision}, ${previous}, ${tx.json(payload)})`;
  await tx`UPDATE yomiru_incremental_head SET revision = ${revision} WHERE singleton`;
  return revision;
}

export async function linkJmdictPage(sql, after = "") {
  if (after !== "" && !wordId.test(after)) throw new Error("Invalid JMdict linking cursor");
  return sql.begin(async tx => {
    const [head] = await tx`SELECT revision, serving FROM yomiru_incremental_head WHERE singleton FOR UPDATE`;
    if (!head?.serving) throw new Error("Incremental publishing is paused");
    const rows = await tx`SELECT id, detail FROM yomiru_incremental_dictionary
      WHERE id > ${after} AND jmdict_entry_id IS NULL AND NOT (detail ? 'jmdictSenses') ORDER BY id LIMIT 250`;
    const matches = await matchJmdict(tx, rows.map(({ detail }) => detail));
    const linked = [];
    for (const { id, detail } of rows) {
      const match = matches.get(id);
      if (!match) continue;
      const word = useJmdictMatch(detail, match);
      await tx`UPDATE yomiru_incremental_dictionary SET detail = ${tx.json(word)},
        jmdict_entry_id = ${match.sourceId} WHERE id = ${id}`;
      linked.push({ id, jmdict_entry_id: Number(match.sourceId), detail: word });
    }
    if (linked.length) await recordDictionaryChange(tx, head.revision, { kind: "jmdict-link", words: linked });
    return { linked: linked.length, next: rows.length === 250 ? rows.at(-1).id : null };
  });
}
