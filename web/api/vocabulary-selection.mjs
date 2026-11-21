import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { reportServerError } from "../lib/sentry-server.mjs";
import { libraryRows } from "../lib/browse.mjs";
import { readPublishedLibrary } from "../lib/published-library.mjs";
import { database, servingPublicationStore } from "../lib/database.mjs";
import { databaseEnabled } from "../lib/storage-config.mjs";
import { createBlobVocabularyReader } from "../lib/episode-vocabulary.mjs";
import { addRenderedPractice } from "../lib/rendered-practice.mjs";
import { addArchivedPractice } from "../lib/archived-practice.mjs";
import { mapBatches } from "../lib/r2-publication.mjs";
import { pageVocabulary, readPostgresVocabulary } from "../lib/postgres-vocabulary.mjs";
import { readPostgresMastery } from "../lib/postgres-mastery.mjs";
import { packMastery, readMasteryRequest, readSnapshotMastery } from "../lib/library-mastery.mjs";
import { combineVocabulary, summarizeVocabulary, vocabularyCsvRows, vocabularyCacheKey } from "../src/vocabulary-export.mjs";
import { sortVocabulary, sortVocabularyByColumn, vocabularyPageSize, vocabularySortColumns } from "../src/vocabulary-study.mjs";
import { isPracticePartOfSpeech, practiceCards } from "../src/vocabulary-practice.mjs";
import { practiceCheckLimit, practiceFromCards, practicePageVersion, practiceReviewSize, sharedPracticeSelectionLimit }
  from "../src/practice-deck.mjs";

const identifier = /^[A-Za-z0-9_.:-]{1,200}$/;
const hash = /^[a-f0-9]{64}$/;
const staleSelection = { error: "The library changed. Reload the page to refresh vocabulary." };
const defaultStore = () => databaseEnabled() ? servingPublicationStore() : null;
const reviewEpisodes = ["tt0112159:1:1"];

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

async function sendCsv(response, words, sort) {
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", 'attachment; filename="yomiru-vocabulary-eng.csv"');
  response.status(200);
  const sorted = sort ? sortVocabularyByColumn(words, sort) : words;
  await pipeline(Readable.from(csvChunks(vocabularyCsvRows(sorted)), { objectMode: false }), response);
}

function* practiceChunks(words) {
  yield '{"words":[';
  let chunk = "";
  for (const [index, word] of words.entries()) {
    chunk += (index ? "," : "") + JSON.stringify(word);
    if (chunk.length >= 32 * 1024) {
      yield chunk;
      chunk = "";
    }
  }
  yield chunk + "]}";
}

export function readPublicVocabularyQuery({ mode, publication, titles, format } = {}) {
  if (mode === "practice-review" && titles === undefined && format === undefined) {
    return typeof publication === "string" && hash.test(publication)
      ? { mode, scope: "titles", publication, episodes: reviewEpisodes.map(id => ({ id })) } : null;
  }
  if (titles !== undefined) {
    if (mode !== "practice-page" || ![practicePageVersion, "context-v1"].includes(format)
      || typeof titles !== "string") return null;
    const ids = titles.split(",");
    if (ids.length > sharedPracticeSelectionLimit || ids.join(",") !== [...ids].sort().join(",")) return null;
    return readSelection({ mode, scope: "titles", publication, titles: ids, practice: {} });
  }
  if (mode === "practice") return readSelection({ mode, scope: "all", publication });
  if (mode === "practice-page") return readSelection({ mode, scope: "all", publication, practice: {} });
  if (mode === "page") return readSelection({
    mode, scope: "all", publication, page: { query: "", category: "", offset: 0 },
  });
  return null;
}

function readPractice(mode, value = {}) {
  if (!value || typeof value !== "object") return null;
  const { after = null, checks = [], review = [], continuation } = value;
  if (!Array.isArray(checks) || checks.length > practiceCheckLimit || checks.some(check => !Array.isArray(check)
    || check.length !== 3 || typeof check[0] !== "string" || !identifier.test(check[0])
    || check.slice(1).some(key => typeof key !== "string" || key.length > 2048 || key.includes("\0")))
    || new Set(checks.map(check => check[0])).size !== checks.length) return null;
  if (!Array.isArray(review) || review.length > practiceReviewSize || new Set(review).size !== review.length
    || review.some(id => typeof id !== "string" || !identifier.test(id))) return null;
  if (after !== null && (!Array.isArray(after) || after.length !== 2 || !Number.isSafeInteger(after[0])
    || after[0] < 1 || typeof after[1] !== "string" || !identifier.test(after[1]))) return null;
  if (mode === "practice-membership" && (after || review.length || !checks.length)) return null;
  if (continuation !== undefined && (mode !== "practice-page" || !after || typeof continuation !== "string"
    || continuation.length > 9000 || !/^[A-Za-z0-9_-]+$/.test(continuation))) return null;
  return { after, checks, review, ...(continuation && { continuation }) };
}

export function readSelection(body) {
  const { episodes, titles, scope, publication, mode, language = "eng", order = "frequency", sort, page, cue } = body ?? {};
  if (!["summary", "study", "practice", "practice-page", "practice-membership", "practice-translation", "csv", "page"].includes(mode)
    || language !== "eng" || (order !== "frequency" && (!["subtitle", "phrase"].includes(order) || mode !== "practice-page"
      || scope !== "titles" || (order === "subtitle" && titles?.length !== 1)
      || body.practice?.continuation !== undefined))) return null;
  if (mode === "practice-translation" ? scope !== "titles" || titles?.length !== 1
    || typeof cue !== "string" || !/^[a-f0-9]{64}:c[0-9]{5}$/.test(cue) : cue !== undefined) return null;
  const practice = ["practice-page", "practice-membership"].includes(mode) ? readPractice(mode, body.practice) : undefined;
  if (practice === null || (!practice && body?.practice !== undefined)) return null;
  if (sort !== undefined && (!["csv", "page"].includes(mode) || !vocabularySortColumns.has(sort?.column)
    || !["ascending", "descending"].includes(sort.direction))) return null;
  if (mode === "page" ? !page || !Number.isInteger(page.offset) || page.offset < 0 || page.offset > 1_000_000
    || typeof page.query !== "string" || page.query.length > 200
    || typeof page.category !== "string" || page.category.length > 24 : page !== undefined) return null;
  if (page?.index !== undefined && (page.index !== true || sort || page.wordIds !== undefined)) return null;
  if (page?.wordIds !== undefined && (page.offset || page.query || page.category || sort
    || !Array.isArray(page.wordIds) || !page.wordIds.length || page.wordIds.length > vocabularyPageSize
    || new Set(page.wordIds).size !== page.wordIds.length
    || page.wordIds.some(id => typeof id !== "string" || !identifier.test(id)))) return null;
  if (scope === "titles" && episodes === undefined) {
    if (typeof publication !== "string" || !hash.test(publication) || !Array.isArray(titles)
      || !titles.length || titles.length > 10000 || new Set(titles).size !== titles.length
      || titles.some(id => typeof id !== "string" || !identifier.test(id))) return null;
    return { scope, publication, episodes: titles.map(id => ({ id })), mode, sort, page, ...(cue && { cue }),
      ...(order !== "frequency" && { order }), ...(practice && { practice }) };
  }
  if (titles !== undefined) return null;
  if (scope === "all" && episodes === undefined) {
    const validPublication = typeof publication === "string" && hash.test(publication);
    if (mode === "summary" ? publication !== undefined : !validPublication) return null;
    return { scope, publication, mode, sort, page, ...(practice && { practice }) };
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
  return { episodes, mode, sort, page, ...(practice && { practice }) };
}

export function createSelectionHandler({ readLibrary = readPublishedLibrary, store = defaultStore,
  readVocabulary = createBlobVocabularyReader(),
  readPostgres = async request => {
    if (store !== defaultStore || !databaseEnabled()) return undefined;
    const sql = database();
    const result = await readPostgresVocabulary(sql, request);
    if (request.mode === "practice-review") return result;
    let contextual = result;
    if (request.mode === "practice-page" && request.order !== "phrase") {
      try { contextual = await addArchivedPractice(sql, request, result); }
      catch (error) {
        if (!result?.canonicalContext) throw error;
        reportServerError(error, "practice-word-peeks");
      }
    }
    try { return await addRenderedPractice(request, contextual); }
    catch (error) {
      if (request.mode === "practice-translation") throw error;
      reportServerError(error, "practice-translation-coverage");
      return contextual;
    }
  },
  readMastery = request => store === defaultStore && databaseEnabled()
    ? readPostgresMastery(database(), request) : undefined } = {}) {
  return async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const publicRead = request.method === "GET";
    if (!publicRead && request.method !== "POST") {
      response.setHeader("Allow", "GET, POST");
      return response.status(405).end();
    }
    let selection, mastery, sharedPractice;
    try {
      const input = publicRead ? request.query
        : typeof request.body === "string" ? JSON.parse(request.body) : request.body;
      if (input?.mode === "mastery") mastery = readMasteryRequest(input, publicRead);
      else selection = publicRead ? readPublicVocabularyQuery(input) : readSelection(input);
      sharedPractice = publicRead && selection?.mode === "practice-page" && input.format === practicePageVersion;
    }
    catch { return response.status(400).json({ error: "Invalid vocabulary selection." }); }
    if (!selection && !mastery) return response.status(400).json({ error: "Invalid vocabulary selection." });

    try {
      if (mastery) {
        const result = await readMastery(mastery) ?? await readSnapshotMastery(
          await readLibrary(), mastery, readVocabulary, await store(),
        );
        if (!result.valid) return response.status(409).json(staleSelection);
        const body = packMastery(result.scopes);
        response.setHeader("X-Yomiru-Publication", result.revision);
        if (publicRead) {
          // Every scope belongs to an immutable publication named in the URL.
          response.setHeader("Cache-Control", "public, max-age=86400");
          response.setHeader("Vercel-CDN-Cache-Control", "public, s-maxage=86400");
        }
        return response.status(200).json(body);
      }
      const all = selection.scope === "all";
      const summarizing = selection.mode === "summary";
      const result = await readPostgres(selection);
      if (result) {
        if (!result.valid) return response.status(409).json(staleSelection);
        const { revision, valid, canonicalContext, renderedPractice, ...body } = result;
        if (body.phrases) body.phrases = body.phrases.map(({ rendered, rank, ...phrase }) => phrase);
        response.setHeader("X-Yomiru-Publication", revision);
        if (selection.mode === "csv") {
          const words = sortVocabulary(combineVocabulary(body.titles, body.documents));
          await sendCsv(response, words, selection.sort);
          return;
        }
        if (publicRead) response.setHeader("Vercel-CDN-Cache-Control",
          sharedPractice ? "public, s-maxage=86400" : "public, s-maxage=15");
        if (selection.mode === "practice") {
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.status(200);
          await pipeline(Readable.from(practiceChunks(body.words), { objectMode: false }), response);
          return;
        }
        return response.status(200).json(body);
      }
      if (selection.mode === "practice-review") return response.status(503).json({ error: "Review is unavailable." });
      const db = await store();
      const includesMovie = selection.episodes?.some(({ id }) => /^tt\d+$/.test(id));
      if (summarizing && db && selection.scope !== "titles" && (db.incremental || !includesMovie)) {
        const result = await db.selectionSummary(selection.episodes);
        if (!result) return response.status(409).json(staleSelection);
        response.setHeader("X-Yomiru-Publication", result.publication);
        return response.status(200).json(all ? result : { total: result.total, covered: result.covered });
      }

      const { index, catalogue, publication } = await readLibrary();
      const rows = new Map(libraryRows(index, catalogue).filter(row => row.vocabulary).map(row => [row.id, row]));
      if ((selection.publication && selection.publication !== publication)
        || selection.episodes?.some(({ id, revision, registry }) => {
          const descriptor = rows.get(id)?.vocabulary;
          return selection.scope === "titles" ? !descriptor
            : descriptor?.sha256 !== revision || descriptor.registry !== registry;
        })) {
        return response.status(409).json(staleSelection);
      }
      response.setHeader("X-Yomiru-Publication", publication);
      if (selection.mode === "practice-translation") return response.status(200).json({ translation: null });
      const ids = all ? [...rows.keys()] : selection.episodes.map(row => row.id);
      const episodes = ids.map(id => rows.get(id));
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
        const movieCount = all ? ids.filter(id => /^tt\d+$/.test(id)).length : 0;
        const scope = all ? { publication, episodeCount: ids.length, ...(movieCount ? { movieCount } : {}) } : {};
        return response.status(200).json({ ...summarizeVocabulary(documents), ...scope });
      }
      const words = sortVocabulary(combineVocabulary(episodes, documents));
      if (selection.practice) {
        const page = practiceFromCards(practiceCards(displayWords(words)), selection,
          selection.order === "subtitle" ? words : undefined);
        return response.status(200).json(selection.order === "phrase"
          ? { ...page, phrases: [], cards: [], next: null } : page);
      }
      if (selection.mode === "page") {
        const page = pageVocabulary(words, selection.page, selection.sort);
        return response.status(200).json(selection.page.index ? page : { ...page, words: displayWords(page.words) });
      }
      if (selection.mode === "csv") {
        await sendCsv(response, words, selection.sort);
        return;
      }
      const displayed = displayWords(words);
      return response.status(200).json({ words: selection.mode === "practice"
        ? displayed.filter(word => isPracticePartOfSpeech(word.pos)) : displayed });
    } catch (error) {
      reportServerError(error, "vocabulary-selection");
      if (response.headersSent || response.destroyed) return;
      return response.status(503).json({ error: "Vocabulary is temporarily unavailable. Try again." });
    }
  };
}

function displayWords(words) {
  return words.map(({ id, word, reading, romaji, pos, aliases, forms, formReadings, meanings, count }) => ({
    id, word, reading, romaji, pos, aliases, forms: [...forms], formReadings: [...formReadings],
    meanings: [...meanings], count,
  }));
}

export default createSelectionHandler();
