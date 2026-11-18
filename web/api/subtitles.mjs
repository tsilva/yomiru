import { decorateSubtitles } from "../lib/feedback-links.mjs";
import { waitUntil } from "@vercel/functions";
import { subtitles, subtitleLabel, validVideoQuery } from "../lib/library.mjs";
import { readPublishedLibrary, publishedAssetOrigin } from "../lib/published-library.mjs";
import { requestRelease, videoGroups, voteSummary, statusLabel } from "../lib/compatibility.mjs";
import { compatibilityStore } from "../lib/compatibility-storage.mjs";
import { publicationStore } from "../lib/database.mjs";
import { databaseEnabled } from "../lib/storage-config.mjs";

async function observe(groups, release, store) {
  const labels = new Map();
  const signal = AbortSignal.timeout(15000);
  let next = 0, failed = false;
  await Promise.all(Array.from({ length: Math.min(4, groups.length) }, async () => {
    while (next < groups.length && !signal.aborted) {
      const group = groups[next++];
      try {
        const state = await store.observe(group, release, signal);
        const observed = state.releases[release.id];
        const label = statusLabel(observed?.summary ?? voteSummary(observed?.votes));
        for (const id of group.trackIds) labels.set(id, `${label}${label === "Unrated" ? "" : " (community)"}`);
      } catch { failed = true; }
    }
  }));
  return { labels, failed: failed || signal.aborted };
}

async function withinBudget(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(null), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

export function createHandler({ readLibrary = readPublishedLibrary, store = compatibilityStore,
  tracksStore = () => databaseEnabled() ? publicationStore() : null,
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
      const { index, publication } = await readLibrary();
      const { type, id } = request.query;
      const db = tracksStore();
      const source = db ? { tracks: validVideoQuery(type, id) ? await db.tracks(publication, type, id) : [] } : index;
      const tracks = subtitles(source, type, id, publishedAssetOrigin());
      const release = requestRelease(request.query);
      if (release && tracks.length) {
        const groups = videoGroups(source, type, id).slice(0, 16);
        const work = observe(groups, release, store);
        background(work.then(() => {}));
        const result = await withinBudget(work, observationBudgetMs);
        for (const track of tracks) {
          const label = result?.labels.get(track.id);
          if (label) track.label = subtitleLabel(source.tracks.find(t => t.id === track.id), label);
        }
        response.setHeader("X-Yomiru-Source-Status", !result ? "pending" : result.failed ? "unavailable" : "recorded");
      }
      decorateSubtitles(tracks, source, type, id, release);
      const ttl = 30;
      response.setHeader("X-Yomiru-Publication", publication);
      response.setHeader("Cache-Control", `public, max-age=${ttl}`);
      return response.status(200).json({ subtitles: tracks, cacheMaxAge: ttl });
    } catch {
      response.setHeader("Cache-Control", "no-store");
      return response.status(503).json({ error: "Subtitle library unavailable" });
    }
  };
}

export default createHandler();
