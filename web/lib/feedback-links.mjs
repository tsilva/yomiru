import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { privateBlobIO } from "./compatibility-storage.mjs";
import { digestPattern, videoGroups, requestRelease } from "./compatibility.mjs";
import { validateIndex, publicOrigin } from "./library.mjs";
import { databaseFeedbackIO } from "./database-feedback.mjs";
import { database } from "./database.mjs";
import { databaseEnabled } from "./storage-config.mjs";

export const codePattern = /^[A-Za-z0-9_-]{12}$/;
export const cueVersion = 3;
const digest = value => createHash("sha256").update(JSON.stringify(value));
export function feedbackCode(group, release, trackId) {
  const identity = [group.type, group.videoId, group.id, release?.id || null];
  if (trackId) identity.push(trackId);
  return digest(identity).digest("base64url").slice(0, 12);
}
export function renderedId(trackId, code) {
  if (!digestPattern.test(trackId) || !codePattern.test(code)) throw new Error("Invalid rendered track");
  return digest([cueVersion, trackId, code]).digest("hex");
}
export function feedbackContext(index, catalogue, type, id, trackId, release, legacy = false) {
  const group = videoGroups(index, type, id).find(g => g.trackIds.includes(trackId));
  if (!group) throw new Error("Unknown subtitle revision");
  const showId = id.split(":")[0], show = catalogue.shows[showId];
  const title = show?.videos.find(v => v.id === id)?.title;
  return { version: 1, code: feedbackCode(group, release, legacy ? null : trackId), group, release,
    ...(legacy ? {} : { trackId }),
    episode: { type, id, showId, title: [show?.name || showId, title || id].join(" · "),
      showName: show?.name || showId, episodeTitle: title || "" },
    tracks: index.tracks.filter(t => group.trackIds.includes(t.id)) };
}
export function validateContext(value, code) {
  if (value?.version !== 1 || !codePattern.test(code) || value.code !== code
    || feedbackCode(value.group, value.release, value.trackId) !== code) throw new Error("Invalid feedback link");
  validateIndex({ version: 1, tracks: value.tracks });
  const group = videoGroups({ tracks: value.tracks }, value.episode.type, value.episode.id)[0];
  if (!group || !isDeepStrictEqual(group, value.group)) throw new Error("Invalid feedback revision");
  if (value.trackId && !group.trackIds.includes(value.trackId)) throw new Error("Invalid feedback track");
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
      if (!existing || existing.group.id !== context.group.id || existing.release?.id !== context.release?.id
        || existing.trackId !== context.trackId)
        throw new Error("Feedback link collision");
      return existing;
    },
  };
}
const neonIO = databaseFeedbackIO(database);
const activeIO = () => databaseEnabled() ? neonIO : privateBlobIO;
export const feedbackLinks = createFeedbackLinks({
  read: (...args) => activeIO().read(...args),
  write: async (path, ...args) => {
    if (process.env.YOMIRU_PAUSE_FEEDBACK === "1") {
      if (await activeIO().read(path)) return false;
      throw new Error("Feedback temporarily read-only");
    }
    return activeIO().write(path, ...args);
  },
});
export function decorateSubtitles(tracks, index, type, id, release) {
  const groups = videoGroups(index, type, id);
  for (const track of tracks) {
    const code = feedbackCode(groups.find(g => g.trackIds.includes(track.id)), release, track.id);
    const query = new URLSearchParams({ code, type, id, v: String(cueVersion) });
    for (const key of ["filename", "videoHash", "videoSize"]) if (release?.[key]) query.set(key, release[key]);
    track.url = `${publicOrigin}/track/${track.id}.ass?${query}`;
    track.id = renderedId(track.id, code);
  }
}
