// Catalogue coverage is derived from published tracks, never from show metadata.
export const catalogueId = "available";
export const cataloguePrefix = "yomiru:";

export function coveredShows(index) {
  const shows = new Map();
  for (const track of index.tracks) {
    if (track.type !== "series") continue;
    // A verified IMDb alias keeps episode playback compatible with other add-ons.
    const ids = track.videoIds.filter(id => /^tt\d{5,12}:\d{1,3}:\d{1,4}$/.test(id));
    if (!ids.length) throw new Error("Catalogue series require a verified IMDb episode alias");
    const [showId, seasonText, episodeText] = ids[0].split(":");
    const season = Number(seasonText), episode = Number(episodeText);
    if (season < 0 || episode < 1) throw new Error("Invalid catalogue episode numbering");
    const videoId = `${showId}:${season}:${episode}`;
    if (!shows.has(showId)) shows.set(showId, new Map());
    const episodes = shows.get(showId);
    if (!episodes.has(videoId)) episodes.set(videoId, { id: videoId, season, episode, tracks: [] });
    episodes.get(videoId).tracks.push(track);
  }
  return shows;
}

const safeImage = value => {
  if (typeof value !== "string" || value.length > 2000) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? value : undefined;
  } catch { return undefined; }
};
const text = (value, limit) => typeof value === "string" ? value.slice(0, limit) : undefined;

export function metadataSnapshot(raw, showId) {
  if (raw?.id !== showId || typeof raw.name !== "string" || !raw.name.trim()) {
    throw new Error("Show metadata identity does not match published subtitles");
  }
  return {
    id: showId,
    name: raw.name.slice(0, 200),
    poster: safeImage(raw.poster),
    background: safeImage(raw.background),
    logo: safeImage(raw.logo),
    releaseInfo: text(raw.releaseInfo, 40),
    description: text(raw.description, 4000),
    videos: (Array.isArray(raw.videos) ? raw.videos : []).filter(v =>
      v.id === `${showId}:${v.season}:${v.episode}` && Number.isInteger(v.season)
      && Number.isInteger(v.episode) && v.season >= 0 && v.episode > 0,
    ).map(v => ({
      id: v.id, season: v.season, episode: v.episode,
      title: text(v.title || v.name, 200),
      thumbnail: safeImage(v.thumbnail),
      released: typeof v.released === "string" && Number.isFinite(Date.parse(v.released))
        ? v.released : undefined,
    })),
  };
}

export function validateSnapshot(snapshot, index) {
  if (snapshot?.version !== 1 || !snapshot.shows || typeof snapshot.shows !== "object"
    || Array.isArray(snapshot.shows) || snapshot.libraryRevision !== index.revision) {
    throw new Error("Catalogue does not match the published library revision");
  }
  const shows = {};
  for (const showId of coveredShows(index).keys()) {
    shows[showId] = metadataSnapshot(snapshot.shows[showId], showId);
  }
  return { ...snapshot, shows };
}

function sources(tracks) {
  return [...new Set(tracks.map(t => t.source.label))].sort().join("; ");
}

function details(index, snapshot, showId) {
  const episodes = coveredShows(index).get(showId);
  const show = snapshot.shows[showId];
  if (!episodes || !show) return null;
  const coverage = [...episodes.values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
  const warning = "Release timing is unverified for your selected video. A matching subtitle source "
    + "or release name does not prove synchronization. Different video edits may need another "
    + "timing version; a constant offset can be adjusted with subtitle delay.";
  return {
    id: `${cataloguePrefix}${showId}`, type: "series", name: show.name,
    poster: show.poster, background: show.background, logo: show.logo,
    releaseInfo: show.releaseInfo,
    links: [{ name: "Subtitle sources & feedback", category: "Yomiru",
      url: `https://yomiru.tsilva.eu/compatibility?show=${showId}` }],
    description: show.description || "",
    videos: coverage.map(episode => {
      const original = show.videos.find(v => v.id === episode.id);
      return {
        id: episode.id, season: episode.season, episode: episode.episode,
        title: original?.title || `Episode ${episode.episode}`,
        released: original?.released, thumbnail: original?.thumbnail,
        links: [{ name: "Subtitle sources & feedback", category: "Yomiru",
          url: `https://yomiru.tsilva.eu/compatibility?type=series&id=${encodeURIComponent(episode.id)}` }],
        overview: `Yomiru subtitles available. Subtitle source: ${sources(episode.tracks)}. `
          + `Target languages: ${[...new Set(episode.tracks.map(t => t.lang.toUpperCase()))].sort().join(", ")}. `
          + warning,
        // Deliberately omit streams/available: other add-ons supply the video.
      };
    }),
  };
}

export function catalogue(index, snapshot, type, id, extra = {}) {
  if (type !== "series" || id !== catalogueId) return [];
  if ((extra.search !== undefined && typeof extra.search !== "string")
    || (extra.skip !== undefined && !/^\d{1,6}$/.test(String(extra.skip)))) return [];
  const search = (extra.search || "").slice(0, 200).trim().toLocaleLowerCase();
  const skip = Number(extra.skip || 0);
  return [...coveredShows(index).keys()].map(showId => details(index, snapshot, showId))
    .filter(show => show && (!search || show.name.toLocaleLowerCase().includes(search)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(skip, skip + 100)
    .map(({ videos, ...show }) => show);
}

export function showMetadata(index, snapshot, type, id) {
  if (type !== "series" || typeof id !== "string" || !/^yomiru:tt\d{5,12}$/.test(id)) return null;
  return details(index, snapshot, id.slice(cataloguePrefix.length));
}
