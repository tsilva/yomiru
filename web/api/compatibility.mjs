import { readPublishedLibrary } from "../lib/published-library.mjs";
import { videoGroups, publicGroup, digestPattern } from "../lib/compatibility.mjs";
import { compatibilityStore } from "../lib/compatibility-storage.mjs";

export function createHandler({ readLibrary = readPublishedLibrary, store = compatibilityStore,
  originProtocol = "https:" } = {}) {
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
      const { type, id } = body || request.query;
      if (!id && request.method === "GET") return response.status(200).json({ episodes: [...episodes.values()] });
      if (!episodes.has(`${type}/${id}`)) return response.status(404).json({ error: "Episode not published" });
      const groups = videoGroups(index, type, id);
      if (groups.length > 16) throw new Error("Too many source revisions");
      const voter = body?.voter || request.headers["x-yomiru-voter"];
      if (voter && !digestPattern.test(voter)) return response.status(400).json({ error: "Invalid voter" });
      if (body) {
        const group = groups.find(g => g.id === body.groupId);
        if (!group) return response.status(409).json({ error: "Subtitle revision changed; refresh before voting" });
        await store.vote(group, body.releaseId, body.voter, body.works);
      }
      const sources = [];
      for (const group of groups) sources.push(publicGroup(group, await store.get(group), voter));
      return response.status(200).json({ episode: episodes.get(`${type}/${id}`), groups: sources });
    } catch {
      return response.status(503).json({ error: "Source feedback is temporarily unavailable. Please try again." });
    }
  };
}

export default createHandler();
