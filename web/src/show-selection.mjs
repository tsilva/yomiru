export function showSelectionState(rows, selected) {
  const selectable = rows.filter(row => row.vocabulary);
  const count = selectable.filter(row => selected.has(row.id)).length;
  return { selectable, checked: selectable.length > 0 && count === selectable.length,
    mixed: count > 0 && count < selectable.length };
}

export function updateShowSelection(selected, rows, checked) {
  const next = new Map(selected);
  for (const row of rows) {
    if (!row.vocabulary) continue;
    if (checked) next.set(row.id, row); else next.delete(row.id);
  }
  return next;
}

export async function loadShowEpisodes(show, publication, { fetcher = fetch, signal } = {}) {
  const rows = new Map(), cursors = new Set();
  let cursor = null;
  do {
    const query = new URLSearchParams({ show });
    if (cursor) query.set("cursor", cursor);
    const response = await fetcher(`/api/browse?${query}`, { signal });
    if (response.status === 409) {
      throw new Error("The library changed. Refresh to select this show.");
    }
    if (!response.ok) throw new Error("Could not load this show's episodes.");
    if (response.headers.get("X-Yomiru-Publication") !== publication) {
      throw new Error("The library changed. Refresh to select this show.");
    }
    const page = await response.json();
    if (!Array.isArray(page.rows) || page.rows.some(row => typeof row.id !== "string" || row.id.split(":")[0] !== show)
      || (page.nextCursor !== null && typeof page.nextCursor !== "string")) throw new Error("Could not verify this show's episodes.");
    page.rows.forEach(row => rows.set(row.id, row));
    cursor = page.nextCursor;
    if (cursor && (cursors.has(cursor) || cursors.size >= 350)) throw new Error("Could not load this show's complete episode list.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...rows.values()];
}
