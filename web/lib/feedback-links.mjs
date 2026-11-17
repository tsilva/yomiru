import { createHash } from "node:crypto";
import { privateBlobIO } from "./compatibility-storage.mjs";
import { digestPattern, videoGroups, requestRelease } from "./compatibility.mjs";
import { validateIndex, publicOrigin } from "./library.mjs";

export const codePattern = /^[A-Za-z0-9_-]{12}$/;
export const cueVersion = 1;
const digest = value => createHash("sha256").update(JSON.stringify(value));
export function feedbackCode(group, release) {
  return digest([group.type, group.videoId, group.id, release?.id || null]).digest("base64url").slice(0, 12);
}
export function renderedId(trackId, code) {
  if (!digestPattern.test(trackId) || !codePattern.test(code)) throw new Error("Invalid rendered track");
  return digest([cueVersion, trackId, code]).digest("hex");
}
export function feedbackContext(index, catalogue, type, id, trackId, release) {
  const group = videoGroups(index, type, id).find(g => g.trackIds.includes(trackId));
  if (!group) throw new Error("Unknown subtitle revision");
  const showId = id.split(":")[0], show = catalogue.shows[showId];
  const title = show?.videos.find(v => v.id === id)?.title;
  return { version: 1, code: feedbackCode(group, release), group, release,
    episode: { type, id, showId, title: [show?.name || showId, title || id].join(" · ") },
    tracks: index.tracks.filter(t => group.trackIds.includes(t.id)) };
}
export function validateContext(value, code) {
  if (value?.version !== 1 || !codePattern.test(code) || value.code !== code
    || feedbackCode(value.group, value.release) !== code) throw new Error("Invalid feedback link");
  validateIndex({ version: 1, tracks: value.tracks });
  const group = videoGroups({ tracks: value.tracks }, value.episode.type, value.episode.id)[0];
  if (!group || JSON.stringify(group) !== JSON.stringify(value.group)) throw new Error("Invalid feedback revision");
  if (value.release) {
    const normalized = requestRelease(value.release);
    if (!normalized || normalized.id !== value.release.id) throw new Error("Invalid feedback source");
  }
  return value;
}
export function createFeedbackLinks(io = privateBlobIO) {
  const path = code => `feedback-links/v1/${code}.json`;
  return {
    async get(code) {
      if (!codePattern.test(code || "")) return null;
      const record = await io.read(path(code));
      return record ? validateContext(record.state, code) : null;
    },
    async ensure(context) {
      validateContext(context, context.code);
      if (await io.write(path(context.code), context, null)) return context;
      const existing = await this.get(context.code);
      if (!existing || existing.group.id !== context.group.id || existing.release?.id !== context.release?.id)
        throw new Error("Feedback link collision");
      return existing;
    },
  };
}
export const feedbackLinks = createFeedbackLinks();
export function decorateSubtitles(tracks, index, type, id, release) {
  const groups = videoGroups(index, type, id);
  for (const track of tracks) {
    const code = feedbackCode(groups.find(g => g.trackIds.includes(track.id)), release);
    const query = new URLSearchParams({ code, type, id });
    for (const key of ["filename", "videoHash", "videoSize"]) if (release?.[key]) query.set(key, release[key]);
    track.url = `${publicOrigin}/track/${track.id}.ass?${query}`;
    track.id = renderedId(track.id, code);
  }
}
