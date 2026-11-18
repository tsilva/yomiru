import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { reportServerError } from "../lib/sentry-server.mjs";
import { episodeRows } from "../lib/browse.mjs";
import { readPublishedLibrary } from "../lib/published-library.mjs";
import { publicationStore } from "../lib/database.mjs";
import { databaseEnabled } from "../lib/storage-config.mjs";
import { createBlobVocabularyReader } from "../lib/episode-vocabulary.mjs";
import { mapBatches } from "../lib/r2-publication.mjs";
import { combineVocabulary, summarizeVocabulary, vocabularyCsvRows, vocabularyCacheKey } from "../src/vocabulary-export.mjs";
import { corpusSorts, sortVocabulary, sortVocabularyByColumn, vocabularyColumns } from "../src/vocabulary-study.mjs";
import { withCorpusRanks } from "../lib/corpus-frequency.mjs";

const identifier = /^[A-Za-z0-9_.:-]{1,200}$/;
const hash = /^[a-f0-9]{64}$/;
const staleSelection = { error: "The library changed. Reload the page to refresh vocabulary." };

function* csvChunks(rows) {
  let chunk = "";
  for (const row of rows) {
    chunk += row;
    if (chunk.length >= 32 * 1024) {
      yield chunk;
      chunk = "";
    }
  }
  if (chunk) yield chunk;
}

function readSelection(body) {
  const { episodes, scope, publication, mode, language = "eng", order = "frequency", sort } = body ?? {};
  if (!["summary", "study", "csv"].includes(mode) || language !== "eng"
    || (!["frequency", "reading"].includes(order) && !corpusSorts.has(order))) return null;
  if (sort !== undefined && (mode !== "csv" || order === "reading" || !vocabularyColumns.has(sort?.column)
    || !["ascending", "descending"].includes(sort.direction))) return null;
  if (scope === "all" && episodes === undefined) {
    const validPublication = typeof publication === "string" && hash.test(publication);
    if (mode === "summary" ? publication !== undefined : !validPublication) return null;
    return { scope, publication, mode, order, sort };
  }
  if (scope !== undefined || publication !== undefined || !Array.isArray(episodes)
    || !episodes.length || episodes.length > 10000) return null;
  const seen = new Set();
  for (const row of episodes) {
    if (typeof row?.id !== "string" || !identifier.test(row.id) || seen.has(row.id)
      || typeof row.revision !== "string" || !hash.test(row.revision)
      || (row.registry !== undefined && (typeof row.registry !== "string" || !hash.test(row.registry)))) return null;
    seen.add(row.id);
  }
  return { episodes, mode, order, sort };
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
      const all = selection.scope === "all";
      const summarizing = selection.mode === "summary";
      const db = store();
      if (summarizing && db) {
        const result = await db.selectionSummary(selection.episodes);
        if (!result) return response.status(409).json(staleSelection);
        response.setHeader("X-Yomiru-Publication", result.publication);
        return response.status(200).json(all ? result : { total: result.total, covered: result.covered });
      }

      const { index, catalogue, publication } = await readLibrary();
      const vocabulary = new Map(index.vocabulary?.flatMap(descriptor =>
        descriptor.videoIds.map(id => [id, descriptor])) ?? []);
      if ((selection.publication && selection.publication !== publication)
        || selection.episodes?.some(({ id, revision, registry }) =>
          vocabulary.get(id)?.sha256 !== revision || registry !== index.registry?.sha256)) {
        return response.status(409).json(staleSelection);
      }
      response.setHeader("X-Yomiru-Publication", publication);
      const ids = all ? [...vocabulary.keys()] : selection.episodes.map(row => row.id);
      let episodes;
      if (summarizing) {
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
      if (summarizing) {
        const scope = all ? { publication, episodeCount: ids.length } : {};
        return response.status(200).json({ ...summarizeVocabulary(documents), ...scope });
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
        const sorted = selection.sort ? sortVocabularyByColumn(words, selection.order, selection.sort) : words;
        const chunks = csvChunks(vocabularyCsvRows(sorted));
        await pipeline(Readable.from(chunks, { objectMode: false }), response);
        return;
      }
      return response.status(200).json({ words: words.map(({
        id, word, reading, romaji, pos, aliases, forms, formReadings, meanings, count, writtenRank, spokenRank,
      }) => ({
        id, word, reading, romaji, pos, aliases, forms: [...forms], formReadings: [...formReadings],
        meanings: [...meanings], count, writtenRank, spokenRank,
      })) });
    } catch (error) {
      reportServerError(error, "vocabulary-selection");
      if (response.headersSent || response.destroyed) return;
      return response.status(503).json({ error: "Vocabulary is temporarily unavailable. Try again." });
    }
  };
}

export default createSelectionHandler();
