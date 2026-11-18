import { head, put, BlobNotFoundError, BlobError } from "@vercel/blob";
import { readPublishedLibrary, assetUrl, publishedAssetOrigin } from "../lib/published-library.mjs";
import { databaseEnabled } from "../lib/storage-config.mjs";
import { createR2Store } from "../lib/r2.mjs";
import { reportServerError } from "../lib/sentry-server.mjs";
import { validateAsset } from "../lib/library.mjs";
import { requestRelease, digestPattern } from "../lib/compatibility.mjs";
import { feedbackLinks, feedbackContext, renderedId, cueVersion, codePattern } from "../lib/feedback-links.mjs";
import { addFeedbackCue } from "../lib/feedback-cue.mjs";

const publicCache = {
  async get(pathname) {
    if (databaseEnabled()) return (await createR2Store().head(pathname))?.url ?? null;
    if (process.env.VERCEL_ENV !== "production" || !process.env.BLOB_STORE_ID) throw new Error("Subtitle cache unavailable");
    try { return (await head(pathname, { storeId: process.env.BLOB_STORE_ID, abortSignal: AbortSignal.timeout(8000) })).url; }
    catch (error) { if (error instanceof BlobNotFoundError) return null; throw error; }
  },
  async put(pathname, bytes) {
    if (databaseEnabled()) return createR2Store().put(pathname, bytes, { contentType: "text/x-ssa; charset=utf-8" });
    try {
      await put(pathname, bytes, { storeId: process.env.BLOB_STORE_ID, access: "public", addRandomSuffix: false,
        allowOverwrite: false, contentType: "text/x-ssa; charset=utf-8", cacheControlMaxAge: 31536000,
        abortSignal: AbortSignal.timeout(10000) });
    } catch (error) {
      if (!(error instanceof BlobError && /already exists/i.test(error.message))) throw error;
    }
  },
};
async function readAsset(track) {
  if (databaseEnabled()) {
    const asset = await createR2Store().read(track.path.slice(1), track.bytes);
    if (!asset) throw new Error("Subtitle asset unavailable");
    return asset.bytes;
  }
  const result = await fetch(assetUrl(track.path), { signal: AbortSignal.timeout(10000), redirect: "error" });
  if (!result.ok) throw new Error("Subtitle asset unavailable");
  const parts = []; let size = 0;
  for await (const chunk of result.body) {
    size += chunk.length;
    if (size > track.bytes) throw new Error("Subtitle asset too large");
    parts.push(chunk);
  }
  const bytes = Buffer.concat(parts); validateAsset(track, bytes); return bytes;
}
export function createHandler({ readLibrary = readPublishedLibrary, links = feedbackLinks,
  cache = publicCache, read = readAsset } = {}) {
  return async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    if (request.method === "OPTIONS") return response.status(204).end();
    if (!["GET", "HEAD"].includes(request.method)) return response.status(405).end();
    const { trackId, code, type, id } = request.query;
    if (!digestPattern.test(trackId || "") || !codePattern.test(code || "")) return response.status(404).end();
    try {
      const pathname = `feedback-tracks/v${cueVersion}/${renderedId(trackId, code)}.ass`;
      const cached = await cache.get(pathname);
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      if (cached) {
        if (!cached.startsWith(`${publishedAssetOrigin()}/feedback-tracks/`)) throw new Error("Invalid cache origin");
        response.setHeader("Location", cached); return response.status(307).end();
      }
      let context = await links.get(code);
      if (!context) {
        const { index, catalogue } = await readLibrary();
        context = feedbackContext(index, catalogue, type, id, trackId, requestRelease(request.query));
        if (context.code !== code) return response.status(404).end();
        context = await links.ensure(context);
      }
      const track = context.tracks.find(t => t.id === trackId);
      if (!track) return response.status(404).end();
      const bytes = await read(track); validateAsset(track, bytes);
      const rendered = addFeedbackCue(bytes, code);
      await cache.put(pathname, rendered);
      response.setHeader("Content-Type", "text/x-ssa; charset=utf-8");
      return response.status(200).send(request.method === "HEAD" ? undefined : rendered);
    } catch (error) {
      reportServerError(error, "track");
      response.setHeader("Cache-Control", "no-store");
      return response.status(503).json({ error: "Subtitle track temporarily unavailable" });
    }
  };
}
export default createHandler();
