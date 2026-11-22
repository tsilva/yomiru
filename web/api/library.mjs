import { readPublishedLibrary, assetUrl } from "../lib/published-library.mjs";
import { createR2Store } from "../lib/r2.mjs";
import { reportServerError } from "../lib/sentry-server.mjs";
import { databaseEnabled } from "../lib/storage-config.mjs";

async function subtitleExists(pathname) {
  if (databaseEnabled()) return Boolean(await createR2Store().head(pathname.slice(1)));
  const response = await fetch(assetUrl(pathname), {
    method: "HEAD", redirect: "error", signal: AbortSignal.timeout(10000),
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Subtitle availability check failed (${response.status})`);
  return true;
}

export function createHandler({ readLibrary = readPublishedLibrary, getAssetUrl = assetUrl,
  hasSubtitle = subtitleExists } = {}) {
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
      if (/^[a-f0-9]{64}\.(?:ass|webp|vocabulary\.json|registry\.json(?:\.gz)?)$/.test(file)) {
        const pathname = `/library/${file}`;
        if (file.endsWith(".ass") && !(await hasSubtitle(pathname))) return response.status(404).end();
        const url = getAssetUrl(pathname);
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
