import { browseEpisodes, browsePage, browseSelection, pageSize, BrowseError } from "../lib/browse.mjs";
import { readPublishedLibrary } from "../lib/published-library.mjs";
import { database, servingPublicationStore } from "../lib/database.mjs";
import { readPostgresCatalogue } from "../lib/postgres-catalogue.mjs";
import { databaseEnabled } from "../lib/storage-config.mjs";
import { reportServerError } from "../lib/sentry-server.mjs";

const defaultStore = () => databaseEnabled() ? servingPublicationStore() : null;

function describeBrowseRows(rows, catalogue) {
  return rows.map(row => {
    const description = row.type === "movie" ? catalogue.movies?.[row.id]?.description
      : catalogue.shows[row.id.split(":")[0]]?.videos.find(video => video.id === row.id)?.overview;
    return { ...row, description: description?.trim() || null };
  });
}

export function createHandler({ readLibrary = readPublishedLibrary, store = defaultStore,
  readPostgres = (query, revisionOnly) => store === defaultStore && databaseEnabled()
    ? readPostgresCatalogue(database(), query, revisionOnly) : undefined } = {}) {
  return async function handler(request, response) {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD");
      return response.status(405).end();
    }
    try {
      const query = request.query ?? {};
      const preselected = await readPostgres(query, request.method === "HEAD");
      let publication, page;
      if (preselected) {
        ({ publication, page } = preselected);
      } else {
        const db = await store();
        const library = db?.incremental ? null : await readLibrary();
        publication = library ? library.publication : await db.current();
        // The protected publisher may predate movie browse rows in Neon.
        // Read the validated snapshot when it contains movie metadata.
        if (db && (db.incremental || !library.catalogue.movies)) {
          const selection = browseSelection(publication, query);
          const rows = await db.browse(publication, selection, pageSize + 1);
          page = browsePage(rows.slice(0, pageSize), rows.length > pageSize, publication, selection);
        } else {
          page = browseEpisodes(library, query);
        }
        if (request.method === "GET" && page.rows.length) {
          const snapshot = library ?? await readLibrary();
          if (snapshot.publication === publication) page.rows = describeBrowseRows(page.rows, snapshot.catalogue);
        }
      }
      if (query.fresh === undefined) {
        response.setHeader("Cache-Control", "public, max-age=30");
      }
      response.setHeader("X-Yomiru-Publication", publication);
      if (request.method === "HEAD") return response.status(200).end();
      return response.status(200).json(page);
    } catch (error) {
      if (error instanceof BrowseError) return response.status(error.status).json({ error: error.message });
      reportServerError(error, "browse");
      return response.status(503).json({ error: "The subtitle library is temporarily unavailable." });
    }
  };
}

export default createHandler();
