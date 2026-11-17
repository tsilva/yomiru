import { catalogue, showMetadata } from "../lib/catalogue.mjs";
import { readPublishedLibrary } from "../lib/published-library.mjs";

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method === "OPTIONS") return response.status(204).end();
  if (!["GET", "HEAD"].includes(request.method)) {
    response.setHeader("Allow", "GET, HEAD, OPTIONS");
    return response.status(405).json({ error: "Read-only Yomiru catalogue" });
  }
  try {
    const { index: library, catalogue: snapshot, publication } = await readPublishedLibrary();
    const { resource, type, id } = request.query;
    response.setHeader("Cache-Control", "public, max-age=30");
    response.setHeader("X-Yomiru-Publication", publication);
    if (resource === "meta") {
      return response.status(200).json({ meta: showMetadata(library, snapshot, type, id), cacheMaxAge: 30 });
    }
    const extra = typeof request.query.extra === "string"
      ? Object.fromEntries(new URLSearchParams(request.query.extra)) : {};
    for (const key of ["search", "skip"]) {
      if (request.query[key] !== undefined) extra[key] = request.query[key];
    }
    return response.status(200).json({ metas: catalogue(library, snapshot, type, id, extra), cacheMaxAge: 30 });
  } catch {
    response.setHeader("Cache-Control", "no-store");
    return response.status(503).json({ error: "Yomiru catalogue unavailable" });
  }
}
