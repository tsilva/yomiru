export function episodeCode(season, episode) {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

// Group by series identity, since distinct series can share a display name.
export function groupEpisodes(rows) {
  const groups = new Map();
  for (const row of rows) {
    const movie = row.type === "movie";
    const id = movie ? "movies" : row.id.split(":")[0];
    if (!groups.has(id)) groups.set(id, { id, name: row.show, rows: [], ...(movie ? { movie } : {}) });
    groups.get(id).rows.push(row);
  }
  return [...groups.values()].map(group => group.movie ? group : {
    ...group, rows: group.rows.sort((a, b) => a.season - b.season || a.episode - b.episode),
  });
}
