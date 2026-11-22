import { waitUntil } from "@vercel/functions";
import { subtitles, validVideoQuery } from "../lib/library.mjs";
import { readPublishedLibrary } from "../lib/published-library.mjs";
import { requestRelease, videoGroups } from "../lib/compatibility.mjs";
import { compatibilityStore } from "../lib/compatibility-storage.mjs";
import { servingPublicationStore } from "../lib/database.mjs";
import { databaseEnabled } from "../lib/storage-config.mjs";
import { reportServerError } from "../lib/sentry-server.mjs";

async function observe(groups, release, store) {
  const signal = AbortSignal.timeout(15000);
  let next = 0, failed = false;
  await Promise.all(Array.from({ length: Math.min(4, groups.length) }, async () => {
    while (next < groups.length && !signal.aborted) {
      const group = groups[next++];
      try { await store.observe(group, release, signal); }
      catch { failed = true; }
    }
  }));
  return failed || signal.aborted ? "unavailable" : "recorded";
}

async function withinBudget(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(null), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

export function createHandler({ readLibrary = readPublishedLibrary, store = compatibilityStore,
  tracksStore = () => databaseEnabled() ? servingPublicationStore() : null,
  background = waitUntil, observationBudgetMs = 1500 } = {}) {
  return async function handler(request, response) {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.method === "OPTIONS") return response.status(204).end();
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD, OPTIONS");
      return response.status(405).json({ error: "Read-only subtitle library" });
    }
    try {
      const { type, id } = request.query;
      const db = await tracksStore();
      const library = db?.incremental ? null : await readLibrary();
      const publication = library ? library.publication : await db.current();
      const source = db ? { tracks: validVideoQuery(type, id) ? await db.tracks(publication, type, id) : [] } : library.index;
      const tracks = subtitles(source, type, id);
      const release = requestRelease(request.query);
      if (release && tracks.length) {
        const groups = videoGroups({ tracks: source.tracks.filter(track => !track.superseded) }, type, id).slice(0, 16);
        const work = observe(groups, release, store);
        background(work.then(() => {}));
        const result = await withinBudget(work, observationBudgetMs);
        response.setHeader("X-Yomiru-Source-Status", result ?? "pending");
      }
      const ttl = 30;
      response.setHeader("X-Yomiru-Publication", publication);
      response.setHeader("Cache-Control", `public, max-age=${ttl}`);
      return response.status(200).json({ subtitles: tracks, cacheMaxAge: ttl });
    } catch (error) {
      reportServerError(error, "subtitles");
      response.setHeader("Cache-Control", "no-store");
      return response.status(503).json({ error: "Subtitle library unavailable" });
    }
  };
}

export default createHandler();
