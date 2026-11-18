import { browseEpisodes, browsePage, browseSelection, pageSize, BrowseError } from "../lib/browse.mjs";
import { readPublishedLibrary } from "../lib/published-library.mjs";
import { publicationStore } from "../lib/database.mjs";
import { databaseEnabled } from "../lib/storage-config.mjs";

export function createHandler({ readLibrary = readPublishedLibrary,
  store = () => databaseEnabled() ? publicationStore() : null } = {}) {
  return async function handler(request, response) {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD");
      return response.status(405).end();
    }
    try {
      const library = await readLibrary();
      const db = store();
      let result;
      if (db) {
        const selection = browseSelection(library.publication, request.query ?? {});
        const rows = await db.browse(library.publication, selection, pageSize + 1);
        result = browsePage(rows.slice(0, pageSize), rows.length > pageSize, library.publication, selection);
      } else {
        result = browseEpisodes(library, request.query);
      }
      response.setHeader("Cache-Control", "public, max-age=30");
      response.setHeader("X-Yomiru-Publication", library.publication);
      if (request.method === "HEAD") return response.status(200).end();
      return response.status(200).json(result);
    } catch (error) {
      if (error instanceof BrowseError) return response.status(error.status).json({ error: error.message });
      return response.status(503).json({ error: "The subtitle library is temporarily unavailable." });
    }
  };
}

export default createHandler();
