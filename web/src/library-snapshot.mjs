const publicationHeader = "X-Yomiru-Publication";
const maxPages = 100;
const storageKey = "yomiru.library-snapshot.v1";

function validRow(row) {
  return typeof row?.id === "string" && typeof row.show === "string"
    && typeof row.title === "string" && typeof row.stremioUrl === "string"
    && Array.isArray(row.translations);
}

export async function readLibrarySnapshot({ origin = "", publication, signal, fetcher = fetch } = {}) {
  const endpoint = `${origin}/api/browse?fresh=1`;
  const options = { cache: "no-store", signal };
  if (publication) {
    const response = await fetcher(endpoint, { ...options, method: "HEAD" });
    if (response.ok && response.headers.get(publicationHeader) === publication) return null;
  }

  // Fetch one consistent publication. A release can land between page requests.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rows = [];
    const ids = new Set();
    const cursors = new Set();
    let revision;
    let cursor = null;
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
      const url = cursor ? `${endpoint}&cursor=${encodeURIComponent(cursor)}` : endpoint;
      const response = await fetcher(url, options);
      const pageRevision = response.headers.get(publicationHeader);
      if (cursor && (response.status === 409 || (response.ok && pageRevision !== revision))) {
        await response.body?.cancel();
        break;
      }
      if (!response.ok || !pageRevision) {
        await response.body?.cancel();
        throw new Error("The subtitle library is temporarily unavailable.");
      }
      const page = await response.json();
      revision = pageRevision;
      if (!Array.isArray(page?.rows) || !page.rows.every(validRow)
        || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor))) {
        throw new Error("The subtitle library returned an invalid page.");
      }
      for (const row of page.rows) {
        if (ids.has(row.id)) throw new Error("The subtitle library repeated a title.");
        ids.add(row.id);
        rows.push(row);
      }
      cursor = page.nextCursor;
      if (!cursor) return { publication: revision, rows };
      if (cursors.has(cursor)) throw new Error("The subtitle library repeated a cursor.");
      cursors.add(cursor);
      if (pageNumber + 1 === maxPages) throw new Error("The subtitle library exceeded the page limit.");
    }
  }
  throw new Error("The subtitle library changed while updating.");
}

export function initialLibrarySnapshot(bundled) {
  if (!bundled) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved?.base === bundled.publication && typeof saved.snapshot?.publication === "string"
      && saved.snapshot.publication && Array.isArray(saved.snapshot.rows) && saved.snapshot.rows.every(validRow)) {
      return saved.snapshot;
    }
  } catch {
    // The bundled snapshot is available even when local storage is blocked.
  }
  return bundled;
}

export function saveLibrarySnapshot(bundled, snapshot) {
  if (!bundled) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify({ base: bundled.publication, snapshot }));
  } catch {
    // The refreshed catalogue is still usable on this page.
  }
}
