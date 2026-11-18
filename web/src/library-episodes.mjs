export function episodeCode(season, episode) {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

// Group by series identity, since distinct series can share a display name.
export function groupEpisodes(rows) {
  const groups = new Map();
  for (const row of rows) {
    const id = row.id.split(":")[0];
    if (!groups.has(id)) groups.set(id, { id, name: row.show, rows: [] });
    groups.get(id).rows.push(row);
  }
  return [...groups.values()].map(group => ({
    ...group, rows: group.rows.sort((a, b) => a.season - b.season || a.episode - b.episode),
  }));
}
