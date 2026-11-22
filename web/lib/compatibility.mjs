import { createHash } from "node:crypto";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const digestPattern = /^[a-f0-9]{64}$/;
export const maxStateBytes = 1024 * 1024;

export function requestRelease(query = {}) {
  const extra = typeof query.extra === "string" && query.extra.length <= 2048
    ? Object.fromEntries(new URLSearchParams(query.extra)) : {};
  const value = key => query[key] ?? extra[key];
  const rawHash = value("videoHash");
  const videoHash = typeof rawHash === "string" && /^[a-f0-9]{16}$/i.test(rawHash)
    ? rawHash.toLowerCase() : null;
  const rawSize = value("videoSize");
  const videoSize = /^\d{1,16}$/.test(String(rawSize)) && Number.isSafeInteger(Number(rawSize))
    && Number(rawSize) > 0 ? Number(rawSize) : null;
  const rawName = value("filename");
  const filename = typeof rawName === "string" && rawName.length <= 1024
    ? rawName.split(/[\\/]/).at(-1).split(/[?#]/)[0].replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 240)
    : "";
  if (!videoHash && !filename) return null;
  return { id: hash([videoHash, videoSize, videoHash ? null : filename]),
    videoHash, videoSize, filename: filename || null, match: videoHash ? "video hash" : "filename only" };
}

export function videoGroups(index, type, videoId) {
  const groups = new Map();
  for (const track of index.tracks.filter(t => t.type === type && t.videoIds.includes(videoId))) {
    const identity = [track.source, track.lang, track.generation || null];
    // Preserve the exact member list used by historical feedback URLs.
    if (track.playbackReady) identity.push(true);
    const key = JSON.stringify(identity);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(track);
  }
  return [...groups.values()].map(tracks => ({
    id: hash([type, videoId, tracks.map(t => [t.id, t.sha256]).sort()]),
    type, videoId, source: tracks[0].source.label, lang: tracks[0].lang,
    trackIds: tracks.map(t => t.id),
  }));
}

export function voteSummary(votes = {}) {
  const values = Object.values(votes);
  const works = values.filter(v => v === true).length;
  const doesntWork = values.filter(v => v === false).length;
  const total = works + doesntWork;
  return { works, doesntWork, total, percentWorks: total ? Math.round(100 * works / total) : null };
}

export function publicGroup(group, state, voter) {
  return { ...group, releases: Object.values(state?.releases || {}).map(release => ({
    id: release.id, filename: release.filename, filenames: release.filenames,
    videoHash: release.videoHash, videoSize: release.videoSize, match: release.match,
    firstSeen: release.firstSeen, lastSeen: release.lastSeen,
    ...(release.summary ?? voteSummary(release.votes)),
    ...(voter ? { myVote: release.summary ? release.myVote : release.votes[hash([group.id, release.id, voter])] ?? null } : {}),
  })).sort((a, b) => Number(a.total > 0) - Number(b.total > 0)
    || (a.filename || a.id).localeCompare(b.filename || b.id)) };
}

export function createCompatibilityStore({ read, write, now = () => new Date().toISOString() }) {
  const pathname = group => `compatibility/v1/${group.id}.json`;
  async function load(group, signal) {
    signal?.throwIfAborted();
    const current = await read(pathname(group), signal);
    if (!current) return { state: { version: 1, groupId: group.id, releases: {} }, etag: null };
    if (current.state.version !== 1 || current.state.groupId !== group.id
      || !current.state.releases || Array.isArray(current.state.releases)) throw new Error("Invalid compatibility state");
    return current;
  }
  async function change(group, update, signal) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { state, etag } = await load(group, signal);
      if (!update(state)) return state;
      if (Buffer.byteLength(JSON.stringify(state)) > maxStateBytes) throw new Error("Compatibility capacity reached");
      signal?.throwIfAborted();
      if (await write(pathname(group), state, etag, signal)) return state;
    }
    throw new Error("Concurrent update; refresh and try again");
  }
  return {
    async get(group) { return (await load(group)).state; },
    async observe(group, release, signal) {
      if (!release) return (await load(group)).state;
      return change(group, state => {
        const timestamp = now();
        let entry = state.releases[release.id];
        if (!entry) {
          if (Object.keys(state.releases).length >= 500) throw new Error("Source capacity reached");
          entry = state.releases[release.id] = { ...release, filenames: [],
            firstSeen: timestamp, lastSeen: timestamp, votes: {} };
        } else if ((!release.filename || entry.filenames.includes(release.filename))
          && timestamp.slice(0, 10) === entry.lastSeen.slice(0, 10)) return false;
        if (release.filename && !entry.filenames.includes(release.filename) && entry.filenames.length < 8) {
          entry.filenames.push(release.filename);
          entry.filename ||= release.filename;
        }
        entry.lastSeen = timestamp;
        return true;
      }, signal);
    },
    async vote(group, releaseId, voter, works) {
      if (!digestPattern.test(releaseId) || !digestPattern.test(voter) || typeof works !== "boolean") {
        throw new Error("Invalid vote");
      }
      return change(group, state => {
        const release = state.releases[releaseId];
        if (!release) throw new Error("Source not observed for this subtitle revision");
        const voterKey = hash([group.id, releaseId, voter]);
        if (release.votes[voterKey] === works) return false;
        if (!(voterKey in release.votes) && Object.keys(release.votes).length >= 5000) throw new Error("Vote capacity reached");
        release.votes[voterKey] = works;
        return true;
      });
    },
  };
}
