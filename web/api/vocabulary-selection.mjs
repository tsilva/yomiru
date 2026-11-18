import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { episodeRows } from "../lib/browse.mjs";
import { readPublishedLibrary } from "../lib/published-library.mjs";
import { publicationStore } from "../lib/database.mjs";
import { databaseEnabled } from "../lib/storage-config.mjs";
import { createBlobVocabularyReader } from "../lib/episode-vocabulary.mjs";
import { mapBatches } from "../lib/r2-publication.mjs";
import { combineVocabulary, summarizeVocabulary, vocabularyCsvRows, vocabularyCacheKey } from "../src/vocabulary-export.mjs";
import { corpusSorts, sortVocabulary } from "../src/vocabulary-study.mjs";
import { withCorpusRanks } from "../lib/corpus-frequency.mjs";

const identifier = /^[A-Za-z0-9_.:-]{1,200}$/;
const hash = /^[a-f0-9]{64}$/;
function readSelection(body) {
  const { episodes, mode, language = "eng", order = "frequency" } = body ?? {};
  if (!["summary", "study", "csv"].includes(mode) || language !== "eng"
    || (!["frequency", "reading"].includes(order) && !corpusSorts.has(order)) || !Array.isArray(episodes)
    || !episodes.length || episodes.length > 10000) return null;
  const seen = new Set();
  for (const row of episodes) {
    if (typeof row?.id !== "string" || !identifier.test(row.id) || seen.has(row.id)
      || typeof row.revision !== "string" || !hash.test(row.revision)
      || (row.registry !== undefined && (typeof row.registry !== "string" || !hash.test(row.registry)))) return null;
    seen.add(row.id);
  }
  return { episodes, mode, order };
}

export function createSelectionHandler({ readLibrary = readPublishedLibrary, store = () =>
  databaseEnabled() ? publicationStore() : null, readVocabulary = createBlobVocabularyReader() } = {}) {
  return async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return response.status(405).end();
    }
    let selection;
    try { selection = readSelection(typeof request.body === "string" ? JSON.parse(request.body) : request.body); }
    catch { return response.status(400).json({ error: "Invalid vocabulary selection." }); }
    if (!selection) return response.status(400).json({ error: "Invalid vocabulary selection." });

    try {
      const { index, catalogue, publication } = await readLibrary();
      const vocabulary = new Map(index.vocabulary?.flatMap(descriptor =>
        descriptor.videoIds.map(id => [id, descriptor])) ?? []);
      if (selection.episodes.some(({ id, revision, registry }) =>
        vocabulary.get(id)?.sha256 !== revision || registry !== index.registry?.sha256)) {
        return response.status(409).json({ error: "The library changed. Reload the page and select the episodes again." });
      }
      response.setHeader("X-Yomiru-Publication", publication);
      const ids = selection.episodes.map(row => row.id);
      const db = store();
      if (selection.mode === "summary" && db) {
        return response.status(200).json(await db.summary(publication, ids));
      }

      let episodes;
      if (selection.mode === "summary") {
        episodes = ids.map(id => ({ id, vocabulary: { ...vocabulary.get(id), registry: index.registry?.sha256 } }));
      } else {
        const rows = db ? await db.episodeRows(publication, ids)
          : new Map(episodeRows(index, catalogue).map(row => [row.id, row]));
        episodes = ids.map(id => rows.get(id));
      }
      const byEpisode = db ? await db.documents(publication, ids) : new Map(await mapBatches(
        episodes, async row => [row.id, await readVocabulary(index, row.vocabulary)],
      ));
      const documents = new Map(episodes.map(({ id, vocabulary: descriptor }) => {
        const document = byEpisode.get(id);
        if (!document || document.anchor !== descriptor.anchor || document.registry !== descriptor.registry
          || document.words.length !== descriptor.words) throw new Error("Vocabulary rows do not match the publication");
        return [vocabularyCacheKey(descriptor), document];
      }));
      if (selection.mode === "summary") {
        return response.status(200).json(summarizeVocabulary(documents));
      }
      const combined = combineVocabulary(episodes, documents);
      const ranked = await withCorpusRanks(combined, {
        written: selection.mode === "study" || selection.order === "written",
        spoken: selection.mode === "study" || selection.order === "spoken",
      });
      const words = sortVocabulary(ranked, selection.order);
      if (selection.mode === "csv") {
        response.setHeader("Content-Type", "text/csv; charset=utf-8");
        response.setHeader("Content-Disposition", 'attachment; filename="yomiru-vocabulary-eng.csv"');
        response.status(200);
        await pipeline(Readable.from(vocabularyCsvRows(words)), response);
        return;
      }
      return response.status(200).json({ words: words.map(({
        id, word, reading, romaji, pos, aliases, forms, meanings, count, writtenRank, spokenRank,
      }) => ({
        id, word, reading, romaji, pos, aliases, forms: [...forms], meanings: [...meanings], count, writtenRank, spokenRank,
      })) });
    } catch {
      if (response.headersSent || response.destroyed) return;
      return response.status(503).json({ error: "Vocabulary is temporarily unavailable. Try again." });
    }
  };
}

export default createSelectionHandler();
