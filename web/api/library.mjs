import { readPublishedLibrary, assetUrl } from "../lib/published-library.mjs";

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  if (request.method === "OPTIONS") return response.status(204).end();
  if (!["GET", "HEAD"].includes(request.method)) {
    response.setHeader("Allow", "GET, HEAD, OPTIONS");
    return response.status(405).json({ error: "Read-only subtitle library" });
  }
  const { file } = request.query;
  if (typeof file !== "string") return response.status(404).end();
  try {
    if (/^[a-f0-9]{64}\.(?:ass|vocabulary\.json|registry\.json(?:\.gz)?)$/.test(file)) {
      const url = assetUrl(`/library/${file}`);
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return response.redirect(307, url);
    }
    if (!["index.json", "catalogue.json"].includes(file)) return response.status(404).end();
    const { index, catalogue, publication } = await readPublishedLibrary();
    response.setHeader("Cache-Control", "public, max-age=30");
    response.setHeader("X-Yomiru-Publication", publication);
    return response.status(200).json(file === "index.json" ? index : catalogue);
  } catch {
    response.setHeader("Cache-Control", "no-store");
    return response.status(503).json({ error: "Subtitle library unavailable" });
  }
}
