import { libraryGroupId } from "./library-episodes.mjs";

const favoritesKey = "yomiru.library-favorites.v1";

export function readFavorites(storage) {
  try {
    const saved = JSON.parse((storage ?? window.localStorage).getItem(favoritesKey));
    const favorites = new Map();
    if (!Array.isArray(saved)) return favorites;
    for (const row of saved) {
      const { id, type, show } = row ?? {};
      if (typeof id !== "string" || !id) continue;
      if (type === "movie" && (typeof show !== "string" || !show)) continue;
      favorites.set(id, { id, ...(type === "movie" && { type, show }), vocabulary: true });
    }
    return favorites;
  } catch {
    return new Map();
  }
}

export function saveFavorites(favorites, storage) {
  try {
    (storage ?? window.localStorage).setItem(favoritesKey, JSON.stringify(
      [...favorites.values()].map(({ id, type, show }) => type === "movie" ? { id, type, show } : { id }),
    ));
  } catch {
    // Favorites remain usable for this visit if browser storage is blocked.
  }
}

export class LibraryPublicationChanged extends Error {
  constructor(message = "The library changed while loading this group.") { super(message); }
}

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
    const response = await fetcher(`/api/browse?${query}`, { signal, cache: "no-store" });
    if (response.status === 409) throw new LibraryPublicationChanged();
    if (!response.ok) throw new Error("Could not load this group.");
    if (response.headers.get("X-Yomiru-Publication") !== publication) {
      throw new LibraryPublicationChanged();
    }
    const page = await response.json();
    if (!Array.isArray(page.rows) || page.rows.some(row => typeof row.id !== "string" || libraryGroupId(row) !== show)
      || (page.nextCursor !== null && typeof page.nextCursor !== "string")) throw new Error("Could not verify this group.");
    page.rows.forEach(row => rows.set(row.id, row));
    cursor = page.nextCursor;
    if (cursor && (cursors.has(cursor) || cursors.size >= 350)) throw new Error("Could not load the complete group.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...rows.values()];
}

export function refreshSelectedTitles(selected, groups) {
  const next = new Map();
  for (const [id, row] of selected) {
    const current = groups.get(libraryGroupId(row));
    const updated = current ? current.get(id) : row;
    if (updated?.vocabulary) next.set(id, updated);
  }
  return next;
}
