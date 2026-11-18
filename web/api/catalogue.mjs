import { showMetadata } from "../lib/catalogue.mjs";
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
  const { resource, type, id } = request.query;
  if (resource !== "meta") {
    // Older installations may still request the retired catalog.
    response.setHeader("Cache-Control", "public, max-age=30");
    return response.status(200).json({ metas: [], cacheMaxAge: 30 });
  }
  try {
    const { index: library, catalogue: snapshot, publication } = await readPublishedLibrary();
    response.setHeader("Cache-Control", "public, max-age=30");
    response.setHeader("X-Yomiru-Publication", publication);
    return response.status(200).json({ meta: showMetadata(library, snapshot, type, id), cacheMaxAge: 30 });
  } catch {
    response.setHeader("Cache-Control", "no-store");
    return response.status(503).json({ error: "Yomiru catalogue unavailable" });
  }
}
