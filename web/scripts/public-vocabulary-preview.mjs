import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readPublicVocabularyQuery, readSelection } from "../api/vocabulary-selection.mjs";
import { readMasteryRequest } from "../lib/library-mastery.mjs";
import { exportVocabulary } from "../src/vocabulary-export.mjs";

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
  if (["practice-page", "practice-membership"].includes(options.mode)) {
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

export async function publicVocabularyPreview(request, response) {
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
    if (mastery) {
      const url = new URL("/api/vocabulary-selection", publicCatalogueOrigin);
      const signal = AbortSignal.timeout(20_000);
      if (request.method === "GET") {
        url.search = new URLSearchParams(mastery);
        result = await fetch(url, { signal });
      } else {
        result = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mastery), signal });
      }
    } else result = await fetchPublicVocabularySelection(selection);
    for (const name of forwardedHeaders) {
      const value = result.headers.get(name);
      if (value) response.setHeader(name, value);
    }
    response.status(result.status);
    if (result.body) await pipeline(Readable.fromWeb(result.body), response);
    else response.end();
  } catch {
    if (!response.headersSent && !response.destroyed) {
      return response.status(503).json({ error: "Vocabulary is temporarily unavailable." });
    }
  }
}
