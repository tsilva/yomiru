import { coveredShows } from "./catalogue.mjs";

export const pageSize = 30;
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

export class BrowseError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// One row per published episode, regardless of source revisions or reading modes.
export function episodeRows(index, snapshot) {
  const rows = [];
  for (const [showId, episodes] of coveredShows(index)) {
    const show = snapshot.shows[showId];
    if (!show) throw new Error("Published show metadata is missing");
    const videos = new Map(show.videos.map(video => [video.id, video]));
    for (const episode of episodes.values()) {
      rows.push({
        id: episode.id, show: show.name, season: episode.season, episode: episode.episode,
        title: videos.get(episode.id)?.title || `Episode ${episode.episode}`,
        translations: [...new Set(episode.tracks.map(track => track.lang))].map(code => ({
          code, label: languageNames.of(code) || code.toUpperCase(),
        })).sort((a, b) => a.label.localeCompare(b.label)),
        stremioUrl: `stremio:///detail/series/${showId}/${episode.id}`,
      });
    }
  }
  return rows.sort((a, b) => a.show.localeCompare(b.show) || a.id.split(":")[0].localeCompare(b.id.split(":")[0])
    || a.season - b.season || a.episode - b.episode);
}

export function browseEpisodes({ index, catalogue, publication }, query = {}) {
  if ((query.search !== undefined && typeof query.search !== "string")
    || (query.cursor !== undefined && typeof query.cursor !== "string")
    || (query.search?.length || 0) > 200) throw new BrowseError("Invalid library search");
  const search = (query.search || "").normalize("NFKC").trim().toLocaleLowerCase();
  let offset = 0;
  if (query.cursor) {
    let cursor;
    try {
      if (!/^[A-Za-z0-9_-]{1,1024}$/.test(query.cursor)) throw new Error();
      cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
    } catch { throw new BrowseError("Invalid library cursor"); }
    if (!Number.isInteger(cursor?.offset) || cursor.offset < 1 || cursor.offset > 10000
      || cursor.search !== search || typeof cursor.publication !== "string") {
      throw new BrowseError("Invalid library cursor");
    }
    if (cursor.publication !== publication) throw new BrowseError("The library changed; reload its first page", 409);
    offset = cursor.offset;
  }
  const terms = search.split(/\s+/).filter(Boolean);
  const matching = episodeRows(index, catalogue).filter(row => {
    const haystack = `${row.show} ${row.title} ${row.id} season ${row.season} episode ${row.episode} `
      + `s${String(row.season).padStart(2, "0")}e${String(row.episode).padStart(2, "0")} `
      + row.translations.map(language => `${language.code} ${language.label}`).join(" ");
    return terms.every(term => haystack.normalize("NFKC").toLocaleLowerCase().includes(term));
  });
  const rows = matching.slice(offset, offset + pageSize);
  const nextOffset = offset + rows.length;
  const nextCursor = nextOffset < matching.length
    ? Buffer.from(JSON.stringify({ publication, search, offset: nextOffset })).toString("base64url") : null;
  return { rows, nextCursor };
}
