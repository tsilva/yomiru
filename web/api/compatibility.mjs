import { feedbackLinks } from "../lib/feedback-links.mjs";
import { readPublishedLibrary } from "../lib/published-library.mjs";
import { videoGroups, publicGroup, digestPattern } from "../lib/compatibility.mjs";
import { compatibilityStore } from "../lib/compatibility-storage.mjs";
import { reportServerError } from "../lib/sentry-server.mjs";

export function createHandler({ readLibrary = readPublishedLibrary, store = compatibilityStore,
  links = feedbackLinks, originProtocol = "https:" } = {}) {
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "no-store");
    if (!["GET", "POST"].includes(request.method)) {
      response.setHeader("Allow", "GET, POST");
      return response.status(405).end();
    }
    if (request.method === "POST"
      && (request.headers.origin !== `${originProtocol}//${request.headers.host}`
        || !/^application\/json(?:;|$)/i.test(request.headers["content-type"] || ""))) {
      return response.status(403).json({ error: "Use the Yomiru feedback page" });
    }
    try {
      const { index, catalogue } = await readLibrary();
      const episodes = new Map();
      for (const track of index.tracks) for (const id of track.videoIds) {
        if (track.type === "series" && !/^tt\d{5,12}:\d{1,3}:\d{1,4}$/.test(id)) continue;
        const [showId, season, episode] = id.split(":");
        const show = catalogue.shows[showId];
        const title = show?.videos.find(v => v.id === id)?.title;
        episodes.set(`${track.type}/${id}`, { type: track.type, id, showId,
          title: show ? `${show.name} · S${season} E${episode}${title ? ` · ${title}` : ""}` : id });
      }
      let body;
      if (request.method === "POST") {
        if (Number(request.headers["content-length"] || 0) > 2048) return response.status(413).end();
        body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
        if (!body || JSON.stringify(body).length > 2048 || typeof body.works !== "boolean"
          || !digestPattern.test(body.voter) || !digestPattern.test(body.groupId)
          || !digestPattern.test(body.releaseId)) return response.status(400).json({ error: "Invalid vote" });
      }
      const code = body?.feedback || request.query.feedback;
      const context = code ? await links.get(code) : null;
      if (code && !context) return response.status(404).json({ error: "Feedback link not found" });
      if (context) episodes.set(`${context.episode.type}/${context.episode.id}`, context.episode);
      const { type, id } = context?.episode || body || request.query;
      if (!id && request.method === "GET") return response.status(200).json({ episodes: [...episodes.values()] });
      if (!episodes.has(`${type}/${id}`)) return response.status(404).json({ error: "Episode not published" });
      const groups = context ? [context.group] : videoGroups(index, type, id);
      if (groups.length > 16) throw new Error("Too many source revisions");
      const voter = body?.voter || request.headers["x-yomiru-voter"];
      if (voter && !digestPattern.test(voter)) return response.status(400).json({ error: "Invalid voter" });
      if (body) {
        const group = groups.find(g => g.id === body.groupId);
        if (!group) return response.status(409).json({ error: "Subtitle revision changed; refresh before voting" });
        if (context && (body.type !== type || body.id !== id
          || (context.release && body.releaseId !== context.release.id)))
          return response.status(400).json({ error: "Vote does not match feedback link" });
        await store.vote(group, body.releaseId, body.voter, body.works);
      }
      if (context?.release) await store.observe(context.group, context.release);
      const sources = [];
      for (const group of groups) {
        const visible = publicGroup(group, await store.get(group, voter), voter);
        if (context?.release) visible.releases = visible.releases.filter(r => r.id === context.release.id);
        sources.push(visible);
      }
      return response.status(200).json({ episode: episodes.get(`${type}/${id}`), groups: sources, feedback: code || null });
    } catch (error) {
      reportServerError(error, "compatibility");
      return response.status(503).json({ error: "Source feedback is temporarily unavailable. Please try again." });
    }
  };
}

export default createHandler();
