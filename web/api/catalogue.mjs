import { discoverPreviews, showMetadata } from "../lib/catalogue.mjs";
import { readPublishedLibrary } from "../lib/published-library.mjs";
import { reportServerError } from "../lib/sentry-server.mjs";

export function createHandler({ readLibrary = readPublishedLibrary } = {}) {
  return async function handler(request, response) {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.method === "OPTIONS") return response.status(204).end();
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD, OPTIONS");
      return response.status(405).json({ error: "Read-only Yomiru catalogue" });
    }
    const { resource, type, id, extra } = request.query;
    const discover = resource === "catalog" && ((type === "series" && id === "published-series")
      || (type === "movie" && id === "published-movies"));
    if (resource !== "meta" && !discover) {
      // Older installations may still request the retired catalog.
      response.setHeader("Cache-Control", "public, max-age=30");
      return response.status(200).json({ metas: [], cacheMaxAge: 30 });
    }
    try {
      const { index, catalogue, publication } = await readLibrary();
      const options = new URLSearchParams(typeof extra === "string" ? extra : "");
      const result = discover
        ? { metas: discoverPreviews(index, catalogue, type, options.get("skip") ?? undefined) }
        : { meta: showMetadata(index, catalogue, type, id) };
      response.setHeader("Cache-Control", "public, max-age=30");
      response.setHeader("X-Yomiru-Publication", publication);
      if (request.method === "HEAD") return response.status(200).end();
      return response.status(200).json({ ...result, cacheMaxAge: 30 });
    } catch (error) {
      reportServerError(error, "catalogue");
      response.setHeader("Cache-Control", "no-store");
      return response.status(503).json({ error: "Yomiru catalogue unavailable" });
    }
  };
}

export default createHandler();
