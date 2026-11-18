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
