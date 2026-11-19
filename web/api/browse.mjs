import { browseEpisodes, browsePage, browseSelection, pageSize, BrowseError } from "../lib/browse.mjs";
import { readPublishedLibrary } from "../lib/published-library.mjs";
import { servingPublicationStore } from "../lib/database.mjs";
import { databaseEnabled } from "../lib/storage-config.mjs";
import { reportServerError } from "../lib/sentry-server.mjs";

export function createHandler({ readLibrary = readPublishedLibrary,
  store = () => databaseEnabled() ? servingPublicationStore() : null } = {}) {
  return async function handler(request, response) {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD");
      return response.status(405).end();
    }
    try {
      const db = await store();
      const library = db?.incremental ? null : await readLibrary();
      const publication = library ? library.publication : await db.current();
      let result;
      // The protected publisher may predate movie browse rows in Neon.
      // Read the validated snapshot when it contains movie metadata.
      if (db && (db.incremental || !library.catalogue.movies)) {
        const selection = browseSelection(publication, request.query ?? {});
        const rows = await db.browse(publication, selection, pageSize + 1);
        result = browsePage(rows.slice(0, pageSize), rows.length > pageSize, publication, selection);
      } else {
        result = browseEpisodes(library, request.query);
      }
      response.setHeader("Cache-Control", "public, max-age=30");
      response.setHeader("X-Yomiru-Publication", publication);
      if (request.method === "HEAD") return response.status(200).end();
      return response.status(200).json(result);
    } catch (error) {
      if (error instanceof BrowseError) return response.status(error.status).json({ error: error.message });
      reportServerError(error, "browse");
      return response.status(503).json({ error: "The subtitle library is temporarily unavailable." });
    }
  };
}

export default createHandler();
