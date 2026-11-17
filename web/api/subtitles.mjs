import { waitUntil } from "@vercel/functions";
import { subtitles, subtitleLabel } from "../lib/library.mjs";
import { readPublishedLibrary, storage } from "../lib/published-library.mjs";
import { requestRelease, videoGroups, voteSummary, statusLabel } from "../lib/compatibility.mjs";
import { compatibilityStore } from "../lib/compatibility-storage.mjs";

async function observe(groups, release, store) {
  const labels = new Map();
  const signal = AbortSignal.timeout(15000);
  let next = 0, failed = false;
  await Promise.all(Array.from({ length: Math.min(4, groups.length) }, async () => {
    while (next < groups.length && !signal.aborted) {
      const group = groups[next++];
      try {
        const state = await store.observe(group, release, signal);
        const label = statusLabel(voteSummary(state.releases[release.id]?.votes));
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
      const tracks = subtitles(index, request.query.type, request.query.id, storage.origin);
      const release = requestRelease(request.query);
      if (release && tracks.length) {
        const groups = videoGroups(index, request.query.type, request.query.id).slice(0, 16);
        const work = observe(groups, release, store);
        background(work.then(() => {}));
        const result = await withinBudget(work, observationBudgetMs);
        for (const track of tracks) {
          const label = result?.labels.get(track.id);
          if (label) track.label = subtitleLabel(index.tracks.find(t => t.id === track.id), label);
        }
        response.setHeader("X-Yomiru-Source-Status", !result ? "pending" : result.failed ? "unavailable" : "recorded");
      }
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
