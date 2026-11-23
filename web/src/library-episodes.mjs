import { rebuildMovies } from "./library-movies.mjs";

export function episodeCode(season, episode) {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

export function libraryGroupId(row) {
  return row.type === "movie" ? `movie:${row.show}` : row.id.split(":")[0];
}

export function libraryTitle(row) {
  return row.type === "movie" ? row.title : `${row.show} ${episodeCode(row.season, row.episode)}`;
}

// Group by series identity, since distinct series can share a display name.
export function groupEpisodes(rows) {
  const groups = new Map();
  for (const row of rows) {
    const movie = row.type === "movie";
    const id = libraryGroupId(row);
    if (!groups.has(id)) groups.set(id, { id, name: row.show, rows: [], ...(movie ? { movie } : {}) });
    groups.get(id).rows.push(row);
  }
  return [...groups.values()].map(group => group.movie ? group : {
    ...group, rows: group.rows.sort((a, b) => a.season - b.season || a.episode - b.episode),
  });
}

export function librarySearchTerms(search) {
  return search.normalize("NFKC").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

export function episodeSearchText(row) {
  const detail = row.type === "movie"
    ? `movies ${row.year ?? ""} ${row.code ?? ""} ${rebuildMovies.get(row.id)?.theatricalTitle ?? ""}`
    : `season ${row.season} episode ${row.episode} s${String(row.season).padStart(2, "0")}e${String(row.episode).padStart(2, "0")}`;
  const subtitleOptions = [...row.translations, ...(row.readingModes || [])];
  return (`${row.show} ${row.title} ${row.id} ${detail} `
    + subtitleOptions.map(({ code, label }) => `${code} ${label}`).join(" ")).normalize("NFKC").toLocaleLowerCase();
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
