// Subtitle library coverage is derived from published tracks.
const cataloguePrefix = "yomiru:";
const discoverPageSize = 100;

export function discoverPreviews(index, snapshot, type, skip = "0") {
  if (typeof skip !== "string" || !/^\d{1,6}$/.test(skip)) return [];
  const active = { tracks: index.tracks.filter(track => !track.superseded && track.type === type) };
  const coverage = type === "series" ? coveredShows(active) : coveredMovies(active);
  const titles = type === "series" ? snapshot.shows : snapshot.movies;
  const offset = Number(skip);

  // Canonical title IDs let Cinemeta supply details and the full episode list.
  return [...coverage.keys()].map(id => titles?.[id]).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id))
    .slice(offset, offset + discoverPageSize)
    .map(({ id, name, poster, posterShape, background, logo, description, releaseInfo }) => ({
      id, type, name, poster, posterShape, background, logo, description, releaseInfo,
      ...(type === "movie" && { behaviorHints: { defaultVideoId: id } }),
    }));
}

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

export function coveredMovies(index) {
  const movies = new Map();
  for (const track of index.tracks) {
    if (track.type !== "movie") continue;
    const id = track.videoIds.find(value => /^tt\d{5,12}$/.test(value));
    if (!id) continue;
    if (!movies.has(id)) movies.set(id, []);
    movies.get(id).push(track);
  }
  return movies;
}

const safeImage = value => {
  if (typeof value !== "string" || value.length > 2000) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? value : undefined;
  } catch { return undefined; }
};
const text = (value, limit) => typeof value === "string" ? value.slice(0, limit) : undefined;

// Preserve descriptive source fields without importing playback transports.
const seriesFields = [
  "type", "awards", "cast", "country", "director", "dvdRelease", "genre", "genres",
  "imdbRating", "imdb_id", "popularity", "popularities", "released", "runtime", "status",
  "tvdb_id", "writer", "year", "moviedb_id", "slug", "trailers", "trailerStreams",
  "posterShape", "language", "website", "links",
];
const episodeFields = [
  "name", "description", "number", "firstAired", "moviedb_id", "imdb_id", "tvdb_id",
  "rating", "ratings", "runtime", "releaseInfo", "genres", "cast", "directors", "links", "trailers",
];

function metadataValue(value, depth = 0, key = "") {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    if (["url", "website", "icon"].includes(key) || /^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        if (!["https:", "stremio:"].includes(url.protocol) || url.username || url.password) {
          return undefined;
        }
      } catch { return undefined; }
    }
    return value.slice(0, 4000);
  }
  if (depth >= 4 || !value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map(v => metadataValue(v, depth + 1)).filter(v => v !== undefined);
  }
  return Object.fromEntries(Object.entries(value).slice(0, 100)
    .filter(([key]) => !["__proto__", "constructor", "prototype"].includes(key))
    .map(([key, v]) => [key, metadataValue(v, depth + 1, key)]).filter(([, v]) => v !== undefined));
}

function descriptiveFields(raw, fields) {
  const result = Object.fromEntries(fields.filter(key => Object.hasOwn(raw, key))
    .map(key => [key, metadataValue(raw[key], 0, key)]).filter(([, value]) => value !== undefined));
  if (Array.isArray(result.links)) {
    result.links = result.links.filter(link => link && typeof link.name === "string"
      && typeof link.category === "string" && typeof link.url === "string"
      && /^(https:\/\/|stremio:\/\/)/i.test(link.url)
      && link.category !== "Yomiru" && link.name !== "Subtitle sources & feedback");
  }
  return result;
}

export function metadataSnapshot(raw, id, type = "series") {
  if (raw?.id !== id || (raw.type !== undefined && raw.type !== type)
    || typeof raw.name !== "string" || !raw.name.trim()) {
    throw new Error("Catalogue metadata identity does not match published subtitles");
  }
  const metadata = {
    ...descriptiveFields(raw, seriesFields),
    id,
    name: raw.name.slice(0, 200),
    poster: safeImage(raw.poster),
    background: safeImage(raw.background),
    logo: safeImage(raw.logo),
    releaseInfo: text(raw.releaseInfo, 40),
    description: text(raw.description, 4000),
  };
  if (type === "movie") return metadata;
  return {
    ...metadata,
    behaviorHints: raw.behaviorHints && descriptiveFields(raw.behaviorHints,
      ["defaultVideoId", "hasScheduledVideos", "isLive"]),
    videos: (Array.isArray(raw.videos) ? raw.videos : []).filter(v =>
      v.id === `${id}:${v.season}:${v.episode}` && Number.isInteger(v.season)
      && Number.isInteger(v.episode) && v.season >= 0 && v.episode > 0,
    ).map(v => ({
      ...descriptiveFields(v, episodeFields),
      id: v.id, season: v.season, episode: v.episode,
      title: text(v.title || v.name, 200),
      overview: text(v.overview, 4000) ?? text(v.description, 4000),
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
  if (!snapshot.movies) return { ...snapshot, shows };
  const movies = {};
  for (const id of coveredMovies(index).keys()) {
    movies[id] = metadataSnapshot(snapshot.movies?.[id], id, "movie");
  }
  return { ...snapshot, shows, movies };
}

function details(index, snapshot, showId) {
  const episodes = coveredShows(index).get(showId);
  const show = snapshot.shows[showId];
  if (!episodes || !show) return null;
  const coverage = [...episodes.values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
  const { videos, ...metadata } = show;
  return {
    ...metadata,
    id: `${cataloguePrefix}${showId}`, type: "series", name: show.name,
    description: show.description || "",
    ...(show.behaviorHints?.defaultVideoId && !coverage.some(v => v.id === show.behaviorHints.defaultVideoId)
      ? { behaviorHints: { ...show.behaviorHints, defaultVideoId: null } } : {}),
    videos: coverage.map(episode => {
      const original = videos.find(v => v.id === episode.id);
      return {
        ...original,
        id: episode.id, season: episode.season, episode: episode.episode,
        title: original?.title || `Episode ${episode.episode}`,
        released: original?.released, thumbnail: original?.thumbnail,
        overview: original?.overview || "",
        // Deliberately omit streams/available: other add-ons supply the video.
      };
    }),
  };
}

export function showMetadata(index, snapshot, type, id) {
  if (type !== "series" || typeof id !== "string" || !/^yomiru:tt\d{5,12}$/.test(id)) return null;
  return details(index, snapshot, id.slice(cataloguePrefix.length));
}
