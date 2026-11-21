import { pipeline } from "node:stream/promises";
import { readPublicVocabularyQuery, readSelection } from "../api/vocabulary-selection.mjs";
import { packMastery, readMasteryRequest } from "../lib/library-mastery.mjs";
import { practiceFromCards } from "../src/practice-deck.mjs";
import { exportVocabulary } from "../src/vocabulary-export.mjs";
import { practiceCards } from "../src/vocabulary-practice.mjs";

export const publicCatalogueOrigin = "https://yomiru.tsilva.eu";
const publicationHeader = "X-Yomiru-Publication";
const forwardedHeaders = ["Content-Type", "Content-Disposition", publicationHeader];
const csvHeaders = {
  "Content-Type": "text/csv; charset=utf-8",
  "Content-Disposition": 'attachment; filename="yomiru-vocabulary-eng.csv"',
};

const staleSelection = () => Response.json(
  { error: "The library changed. Reload the page to refresh vocabulary." }, { status: 409 },
);

export async function fetchPublicVocabularySelection(selection, fetcher = fetch) {
  const signal = AbortSignal.timeout(20_000);
  const { scope, publication: requestedPublication, ...options } = selection;
  const selectionUrl = new URL("/api/vocabulary-selection", publicCatalogueOrigin);
  const select = body => fetcher(selectionUrl, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  if (scope === "titles") return select({
    ...options, scope, publication: requestedPublication, episodes: undefined,
    titles: options.episodes.map(({ id }) => id),
  });
  if (options.page?.history
    || ["practice", "practice-page", "practice-membership", "conjugation-review"].includes(options.mode)) {
    return select({ ...options, scope, publication: requestedPublication });
  }
  if (scope !== "all") return select(options);

  // The hosted all-scope route can still include withdrawn titles. Resolve the
  // visible catalogue here until the hosted handler uses the corrected scope.
  const episodes = [];
  const cursors = new Set();
  let publication;
  let movieCount = 0;
  let cursor;
  do {
    const browseUrl = new URL("/api/browse", publicCatalogueOrigin);
    if (cursor) browseUrl.searchParams.set("cursor", cursor);
    const page = await fetcher(browseUrl, { signal });
    const pagePublication = page.headers.get(publicationHeader);
    if (page.status === 409) {
      await page.body?.cancel();
      return staleSelection();
    }
    if (!page.ok || !pagePublication) {
      await page.body?.cancel();
      throw new Error("Could not resolve the public catalogue");
    }
    if ((publication && pagePublication !== publication)
      || (requestedPublication && pagePublication !== requestedPublication)) {
      await page.body?.cancel();
      return staleSelection();
    }
    publication = pagePublication;
    const { rows, nextCursor } = await page.json();
    for (const { id, type, vocabulary } of rows) {
      if (!vocabulary) continue;
      episodes.push({ id, revision: vocabulary.sha256, registry: vocabulary.registry });
      if (type === "movie") movieCount += 1;
    }
    if (cursors.has(nextCursor)) throw new Error("The public catalogue repeated a cursor");
    cursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  const headers = { [publicationHeader]: publication };
  const counts = { publication, episodeCount: episodes.length, ...(movieCount ? { movieCount } : {}) };
  if (!episodes.length) {
    if (options.mode === "summary") return Response.json({ total: 0, covered: {}, ...counts }, { headers });
    if (["study", "practice", "page"].includes(options.mode)) {
      return Response.json({ words: [], ...(options.mode === "page" && { nextOffset: null }) }, { headers });
    }
    return new Response(exportVocabulary([]), { headers: { ...headers, ...csvHeaders } });
  }
  const result = await select({ ...options, episodes });
  if (!result.ok) return result;
  if (result.headers.get(publicationHeader) !== publication) {
    await result.body?.cancel();
    return staleSelection();
  }
  if (options.mode !== "summary") return result;
  return Response.json({ ...await result.json(), ...counts }, { headers });
}

// The hosted app may run an older practice policy. Reuse its compact roster and
// run the local policy for practice and mastery. Keep one roster per scope kind.
const practiceRosters = new Map();

async function publicPracticeRoster({ scope, publication, episodes }) {
  const slot = scope === "all" ? "all" : "selection";
  const key = JSON.stringify([scope, publication, episodes]);
  const cached = practiceRosters.get(slot);
  if (cached?.key === key) return cached.result;
  const result = (async () => {
    const response = await fetchPublicVocabularySelection({ scope, publication, episodes, mode: "practice" });
    if (response.status === 409) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Could not read the public practice roster");
    }
    const revision = response.headers.get(publicationHeader);
    if (!revision || (publication && revision !== publication)) {
      await response.body?.cancel();
      return null;
    }
    const { words } = await response.json();
    const cards = practiceCards(words.map(row => {
      if (!Array.isArray(row)) return row;
      const [id, word, reading, romaji, pos, meanings, count] = row;
      return { id, word, reading, romaji, pos, meanings, count };
    }));
    return { cards, ids: new Set(cards.map(card => card.id)), revision };
  })();
  practiceRosters.set(slot, { key, result });
  try {
    return await result;
  } catch (error) {
    if (practiceRosters.get(slot)?.result === result) practiceRosters.delete(slot);
    throw error;
  }
}

async function publicEpisodePractice(selection, fetcher = fetch) {
  const [{ id }] = selection.episodes;
  const slot = "episode";
  const key = JSON.stringify([selection.publication, id]);
  let cached = practiceRosters.get(slot);
  if (cached?.key !== key) {
    const result = (async () => {
      const signal = AbortSignal.timeout(20_000);
      const browse = new URL("/api/browse", publicCatalogueOrigin);
      browse.searchParams.set("show", id.split(":")[0]);
      const cursors = new Set();
      let row;
      do {
        const response = await fetcher(browse, { signal });
        if (response.status === 409 || response.headers.get(publicationHeader) !== selection.publication) {
          await response.body?.cancel();
          return null;
        }
        if (!response.ok) throw new Error("Could not load the public episode");
        const { rows, nextCursor } = await response.json();
        row = rows.find(item => item.id === id);
        if (row || !nextCursor) break;
        if (cursors.has(nextCursor)) throw new Error("The public catalogue repeated a cursor");
        cursors.add(nextCursor);
        browse.searchParams.set("cursor", nextCursor);
      } while (!signal.aborted);
      if (!row?.vocabulary) return null;
      const { sha256, registry } = row.vocabulary;
      const url = new URL("/api/vocabulary", publicCatalogueOrigin);
      url.search = new URLSearchParams({ episode: id, revision: sha256, ...(registry && { registry }) });
      const response = await fetcher(url, { signal });
      if (response.status === 409 || response.headers.get(publicationHeader) !== selection.publication) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) throw new Error("Could not load the public episode words");
      const { words } = await response.json();
      const cards = practiceCards(words.map(word => ({ ...word, meanings: word.meanings.eng ?? [] })));
      return { words, cards, cues: new Map(words.map(word => [word.id, word.examples[0]?.cue])) };
    })();
    cached = { key, result };
    practiceRosters.set(slot, cached);
  }
  try { return await cached.result; }
  catch (error) {
    if (practiceRosters.get(slot) === cached) practiceRosters.delete(slot);
    throw error;
  }
}

export async function publicVocabularyPreview(request, response, addPracticeExamples, readTranslation, readPhrases) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).end();
  }
  let selection, mastery;
  try {
    const publicRead = request.method === "GET";
    const input = publicRead ? request.query : JSON.parse(request.body);
    if (input?.mode === "mastery" && readMasteryRequest(input, publicRead)) mastery = input;
    else selection = publicRead ? readPublicVocabularyQuery(input) : readSelection(input);
  } catch {}
  if (!selection && !mastery) return response.status(400).json({ error: "Invalid vocabulary selection." });
  try {
    let result;
    if (selection?.mode === "practice-review") {
      const url = new URL("/api/vocabulary-selection", publicCatalogueOrigin);
      url.search = new URLSearchParams({ mode: selection.mode, publication: selection.publication });
      if (selection.cursor) url.searchParams.set("cursor", selection.cursor);
      result = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    } else if (selection?.mode === "practice-translation" && readTranslation) {
      const translation = await readTranslation(selection);
      result = Response.json({ translation }, { headers: { [publicationHeader]: selection.publication } });
    } else if (selection?.order === "phrase") {
      if (!readPhrases) result = await fetchPublicVocabularySelection(selection);
      else {
        const roster = await publicPracticeRoster(selection);
        result = roster ? Response.json(await readPhrases(selection, roster.cards),
          { headers: { [publicationHeader]: roster.revision } }) : staleSelection();
      }
    } else if (selection?.order === "subtitle") {
      const roster = await publicEpisodePractice(selection);
      if (!roster) result = staleSelection();
      else {
        const page = practiceFromCards(roster.cards, selection, roster.words);
        const body = addPracticeExamples ? await addPracticeExamples(page, selection, roster.cues, roster) : page;
        result = Response.json(body, { headers: { [publicationHeader]: selection.publication } });
      }
    } else if (selection?.practice) {
      const roster = await publicPracticeRoster(selection);
      if (!roster) result = staleSelection();
      else {
        const page = practiceFromCards(roster.cards, selection);
        const body = selection.mode === "practice-page" && addPracticeExamples
          ? await addPracticeExamples(page, selection) : page;
        result = Response.json(body, { headers: { [publicationHeader]: roster.revision } });
      }
    } else if (mastery) {
      const url = new URL("/api/vocabulary-selection", publicCatalogueOrigin);
      const signal = AbortSignal.timeout(20_000);
      if (request.method === "GET") {
        url.search = new URLSearchParams(mastery);
        result = await fetch(url, { signal });
      } else {
        result = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mastery), signal });
      }
      if (result.ok) {
        const roster = await publicPracticeRoster({ scope: "all", publication: mastery.publication });
        const revision = result.headers.get(publicationHeader);
        if (!roster || roster.revision !== revision) {
          await result.body?.cancel();
          result = staleSelection();
        } else {
          const { words, scopes } = await result.json();
          const filtered = scopes.map(([kind, id, members]) => [kind, id,
            members.map(index => words[index]).filter(word => roster.ids.has(word))]);
          result = Response.json(packMastery(filtered), { headers: { [publicationHeader]: revision } });
        }
      }
    } else result = await fetchPublicVocabularySelection(selection);
    for (const name of forwardedHeaders) {
      const value = result.headers.get(name);
      if (value) response.setHeader(name, value);
    }
    response.status(result.status);
    if (result.body) await pipeline(result.body, response);
    else response.end();
  } catch {
    if (!response.headersSent && !response.destroyed) {
      return response.status(503).json({ error: "Vocabulary is temporarily unavailable." });
    }
  }
}
