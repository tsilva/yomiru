import { coveredMovies, coveredShows } from "./catalogue.mjs";
import { dictionaryRevision, readingLabels, readingModes as activeReadingModes } from "./library.mjs";
import { libraryGroupId } from "../src/library-episodes.mjs";

export const pageSize = 30;
const cursorVersion = 1;
const movieCollections = new Map([
  ["Rebuild of Evangelion", ["tt0923811", "tt0860906", "tt0860907", "tt2458948"]],
  ["One Piece Movies", [
    "tt0814243", "tt0832449", "tt0997084", "tt1006926", "tt1010435",
    "tt1018764", "tt1059950", "tt1037116", "tt1206326", "tt1485763",
    "tt1865467", "tt2375379", "tt5251328", "tt9430698", "tt16183464",
  ]],
]);
const otherMovies = "Other Movies";
const movieGroups = new Set([...movieCollections.keys(), otherMovies].map(name => `movie:${name}`));
export const moviePositions = [...movieCollections].flatMap(([name, ids], group) =>
  ids.map((id, index) => ({ id, name, group, number: index + 1 })));
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

export function subtitleCoverage(tracks) {
  const languages = new Set();
  const scripts = new Set();
  for (const track of tracks) {
    if (track.lang === "jpn") scripts.add(track.script);
    else languages.add(track.lang);
  }
  const translations = [...languages].map(code => ({ code, label: languageNames.of(code) || code.toUpperCase() }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const readingModes = activeReadingModes.filter(code => scripts.has(code))
    .map(code => ({ code, label: readingLabels[code] }));
  return { translations, ...(readingModes.length && { readingModes }) };
}

export class BrowseError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function vocabularyFor(index, id) {
  const entry = index.vocabulary?.find(entry => entry.videoIds.includes(id));
  const registry = dictionaryRevision(index);
  return entry ? { ...entry, ...(registry && { registry }) } : null;
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
        ...subtitleCoverage(episode.tracks),
        stremioUrl: `stremio:///detail/series/${showId}/${episode.id}`,
        vocabulary: vocabularyFor(index, episode.id),
      });
    }
  }
  return rows.sort((a, b) => a.show.localeCompare(b.show) || a.id.split(":")[0].localeCompare(b.id.split(":")[0])
    || a.season - b.season || a.episode - b.episode);
}

export function episodeSearchText(row) {
  const detail = row.type === "movie" ? `movies ${row.year ?? ""} ${row.code ?? ""}`
    : `season ${row.season} episode ${row.episode} s${String(row.season).padStart(2, "0")}e${String(row.episode).padStart(2, "0")}`;
  const subtitleOptions = [...row.translations, ...(row.readingModes || [])];
  return (`${row.show} ${row.title} ${row.id} ${detail} `
    + subtitleOptions.map(({ code, label }) => `${code} ${label}`).join(" ")).normalize("NFKC").toLocaleLowerCase();
}

function codedMovie(row, show, number) {
  return { ...row, show, code: `M${String(number).padStart(2, "0")}` };
}

function movieYear({ year }) {
  return (typeof year === "number" || typeof year === "string") && /^\d{4}$/.test(year)
    ? Number(year) : Infinity;
}

export function sequenceMovies(rows) {
  const remaining = new Map(rows.map(row => [row.id, row]));
  const ordered = [];
  for (const [group, ids] of movieCollections) {
    ids.forEach((id, index) => {
      const row = remaining.get(id);
      if (row) {
        ordered.push(codedMovie(row, group, index + 1));
        remaining.delete(id);
      }
    });
  }
  const other = [...remaining.values()].sort((a, b) =>
    movieYear(a) - movieYear(b) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return [...ordered, ...other.map((row, index) => codedMovie(row, otherMovies, index + 1))];
}

function movieRows(index, catalogue) {
  const rows = [];
  for (const [id, tracks] of coveredMovies(index)) {
    const movie = catalogue.movies?.[id];
    const activeTracks = tracks.filter(track => !track.superseded);
    if (!movie || !activeTracks.length) continue;
    rows.push({
      type: "movie", id,
      title: movie.name, year: movie.year,
      ...subtitleCoverage(activeTracks),
      stremioUrl: `stremio:///detail/movie/${id}/${id}`,
      vocabulary: vocabularyFor(index, id),
    });
  }
  return sequenceMovies(rows);
}

export function libraryRows(index, catalogue) {
  return [...episodeRows(index, catalogue), ...movieRows(index, catalogue)];
}

export function browseSelection(publication, query) {
  const show = query.show === "movie:Movies" ? `movie:${otherMovies}` : query.show ?? "";
  if ((query.search !== undefined && typeof query.search !== "string")
    || (query.show !== undefined && (typeof query.show !== "string" || (!/^tt\d{1,20}$/.test(show)
      && !movieGroups.has(show))))
    || (query.cursor !== undefined && typeof query.cursor !== "string")
    || (query.search?.length || 0) > 200) throw new BrowseError("Invalid library search");
  const search = (query.search || "").normalize("NFKC").trim().toLocaleLowerCase();
  let offset = 0;
  let after;
  let expectedPublication;
  if (query.cursor) {
    let cursor;
    try {
      if (!/^[A-Za-z0-9_-]{1,1024}$/.test(query.cursor)) throw new Error();
      cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
    } catch { throw new BrowseError("Invalid library cursor"); }
    if (!Number.isInteger(cursor?.offset) || cursor.offset < 1 || cursor.offset > 1_000_000
      || cursor.search !== search || (cursor.show || "") !== show || typeof cursor.publication !== "string") {
      throw new BrowseError("Invalid library cursor");
    }
    if ((publication !== null && cursor.publication !== publication) || cursor.version !== cursorVersion) {
      throw new BrowseError("The library changed; reload its first page", 409);
    }
    if (cursor.after !== undefined && (!Array.isArray(cursor.after) || cursor.after.length !== 2
      || ![0, 1].includes(cursor.after[0]) || !Number.isSafeInteger(cursor.after[1]) || cursor.after[1] < 1)) {
      throw new BrowseError("Invalid library cursor");
    }
    after = cursor.after;
    expectedPublication = cursor.publication;
    offset = cursor.offset;
  }
  return { search, show, offset, ...(after && { after }), ...(expectedPublication && { expectedPublication }),
    terms: search.split(/\s+/).filter(Boolean) };
}

export function browsePage(rows, hasMore, publication, { search, show, offset }, after) {
  const nextCursor = hasMore
    ? Buffer.from(JSON.stringify({ version: cursorVersion, publication, search, show, offset: offset + rows.length,
      ...(after && { after }) })).toString("base64url") : null;
  return { rows, nextCursor };
}

export function filterLibraryRows(rows, { show, terms }) {
  if (!show && !terms.length) return rows;
  return rows.filter(row => {
    if (show && libraryGroupId(row) !== show && row.id !== show) return false;
    if (!terms.length) return true;
    const text = episodeSearchText(row);
    return terms.every(term => text.includes(term));
  });
}

export function browseEpisodes({ index, catalogue, publication }, query = {}) {
  const selection = browseSelection(publication, query);
  const { offset } = selection;
  const matching = filterLibraryRows(libraryRows(index, catalogue), selection);
  const rows = matching.slice(offset, offset + pageSize);
  return browsePage(rows, offset + rows.length < matching.length, publication, selection);
}
