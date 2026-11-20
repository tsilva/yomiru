import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { practiceSourceRevisions } from "./practice-context.mjs";
import { createPrivateSourceStore } from "./r2.mjs";
import manifest from "./practice-archive.json" with { type: "json" };

const archiveCacheSize = 16;
const maxAnalysisBytes = 12 * 1024 * 1024;

function createAnalysisReader(read, catalogue) {
  const cache = new Map();
  return async (descriptor, kind, revision) => {
    const { sha256, bytes } = descriptor;
    let entry = cache.get(sha256);
    cache.delete(sha256);
    entry ??= (async () => {
      const object = await read(`analyses/${sha256}.json.gz`, bytes);
      if (object?.bytes.length !== bytes || createHash("sha256").update(object.bytes).digest("hex") !== sha256) {
        throw new Error("Practice analysis integrity check failed");
      }
      const data = JSON.parse(gunzipSync(object.bytes, { maxOutputLength: maxAnalysisBytes }));
      if (data.version !== catalogue.version || data.kind !== kind || (revision && data.sourceRevision !== revision)) {
        throw new Error("Practice analysis identity changed");
      }
      if (!revision) return data;
      const cues = new Map(data.cues.map(([id, ...cue]) => [id, cue]));
      const words = new Map();
      for (const [cue, word, gloss, ...spans] of data.examples) {
        const [kana, romaji, peeks] = cues.get(cue);
        if (!words.has(word)) words.set(word, []);
        words.get(word).push({ gloss, example: [`${revision}:${cue}`, kana, romaji, ...spans], peeks });
      }
      return words;
    })();
    cache.set(sha256, entry);
    if (cache.size > archiveCacheSize) cache.delete(cache.keys().next().value);
    try { return await entry; }
    catch (error) {
      if (cache.get(sha256) === entry) cache.delete(sha256);
      throw error;
    }
  };
}

function sourcesForCards(sourceIds, index, cards) {
  if (sourceIds.length === 1) return [[sourceIds[0], cards]];
  const selected = new Set(sourceIds);
  const candidates = new Map(sourceIds.map(id => [id, []]));
  for (const card of cards) {
    for (const position of index.words[card[0]] ?? []) {
      const id = index.sources[position];
      if (selected.has(id)) candidates.get(id).push(card);
    }
  }
  return [...candidates].filter(([, words]) => words.length)
    .sort((a, b) => b[1].length - a[1].length);
}

async function lookupGlosses(sql, words, revision) {
  const [{ valid, meanings }] = await sql`
    SELECT EXISTS (SELECT 1 FROM yomiru_incremental_head WHERE singleton AND serving AND revision = ${revision}) AS valid,
      coalesce((SELECT jsonb_object_agg(dictionary.id, meaning.gloss)
        FROM yomiru_incremental_dictionary AS dictionary
        CROSS JOIN LATERAL (
          SELECT btrim(value) AS gloss FROM jsonb_array_elements_text(dictionary.detail #> '{meanings,eng}')
            WITH ORDINALITY AS entry(value, position)
          WHERE length(btrim(value)) BETWEEN 1 AND 100 ORDER BY position LIMIT 1
        ) AS meaning WHERE dictionary.id = ANY(${sql.array(words, 25)})), '{}'::jsonb) AS meanings`;
  return { valid, meanings };
}

export function createArchivedPracticeReader(read, catalogue = manifest) {
  const load = createAnalysisReader(read, catalogue);
  return async (sql, request, page) => {
    if (!page?.valid || (!page.cards.length && !page.reviews.length)) return page;
    const [{ revisions }] = await sql`SELECT ${practiceSourceRevisions(sql, request, true)} AS revisions`;
    const available = revisions.filter(id => Object.hasOwn(catalogue.sources, id)).sort();
    if (!available.length) return page;
    const cards = [...page.cards, ...page.reviews];
    const index = available.length > 1 ? await load(catalogue.index, "practice-index") : null;
    const sources = sourcesForCards(available, index, cards);
    const found = new Map();
    // Broad selections open only as many archives as their current page needs.
    for (const [revision, candidates] of sources) {
      const needed = candidates.filter(card => !found.has(card[0]));
      if (!needed.length) continue;
      const words = await load(catalogue.sources[revision], "practice-cues", revision);
      for (const card of needed) {
        const matches = words.get(card[0])?.filter(row => row.gloss === card[5]);
        if (matches?.length) found.set(card[0], matches);
      }
    }
    if (!found.size) return page;
    const peekIds = new Set();
    for (const examples of found.values()) {
      for (const { peeks } of examples) for (const [id] of peeks ?? []) peekIds.add(id);
    }
    const { valid, meanings } = await lookupGlosses(sql, [...peekIds], page.revision);
    if (!valid) return { ...page, valid };
    const enrich = card => {
      const examples = found.get(card[0])?.map(({ example, peeks }) => {
        const hints = (peeks ?? []).flatMap(([id, ...spans]) =>
          id !== card[0] && Object.hasOwn(meanings, id) ? [[id, meanings[id], ...spans]] : []);
        return hints.length ? [...example, hints] : example;
      });
      return examples ? [...card.slice(0, 10), examples, ...card.slice(11)] : card;
    };
    return { ...page, cards: page.cards.map(enrich), reviews: page.reviews.map(enrich) };
  };
}

let readProductionPractice;
export function addArchivedPractice(sql, request, page) {
  if (process.env.VERCEL_ENV !== "production" || process.env.YOMIRU_PRACTICE_CONTEXT === "0"
    || !page?.valid) return page;
  readProductionPractice ??= createArchivedPracticeReader((path, limit) => createPrivateSourceStore().read(path, limit));
  return readProductionPractice(sql, request, page);
}
