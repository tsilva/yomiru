import { readPublishedLibrary, assetUrl } from "../lib/published-library.mjs";
import { validateAsset } from "../lib/library.mjs";
import { readSubtitleAsset } from "../lib/published-track.mjs";
import { reportServerError } from "../lib/sentry-server.mjs";

export function createHandler({ readLibrary = readPublishedLibrary, readAsset = readSubtitleAsset } = {}) {
  return async function handler(request, response) {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "OPTIONS") return response.status(204).end();
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD, OPTIONS");
      return response.status(405).json({ error: "Read-only subtitle library" });
    }
    const { file } = request.query;
    if (typeof file !== "string") return response.status(404).end();
    try {
      const subtitle = /^([a-f0-9]{64})\.ass$/.exec(file);
      if (subtitle) {
        const asset = await readAsset(`/library/${file}`);
        if (!asset) return response.status(404).end();
        const { bytes } = asset;
        validateAsset({ sha256: subtitle[1], bytes: bytes.length }, bytes);
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        response.setHeader("Vercel-CDN-Cache-Control", "public, s-maxage=31536000");
        response.setHeader("Content-Type", "text/x-ssa; charset=utf-8");
        response.setHeader("Content-Length", bytes.length);
        if (request.method === "HEAD") return response.status(200).end();
        return response.status(200).send(bytes);
      }
      if (/^[a-f0-9]{64}\.(?:webp|vocabulary\.json|registry\.json(?:\.gz)?)$/.test(file)) {
        const url = assetUrl(`/library/${file}`);
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        return response.redirect(307, url);
      }
      if (!["index.json", "catalogue.json"].includes(file)) return response.status(404).end();
      const { index, catalogue, publication } = await readLibrary();
      response.setHeader("Cache-Control", "public, max-age=30");
      response.setHeader("X-Yomiru-Publication", publication);
      response.setHeader("X-Yomiru-Practice-Source", "bound-v1");
      return response.status(200).json(file === "index.json" ? index : catalogue);
    } catch (error) {
      reportServerError(error, "library");
      response.setHeader("Cache-Control", "no-store");
      return response.status(503).json({ error: "Subtitle library unavailable" });
    }
  };
}

export default createHandler();
