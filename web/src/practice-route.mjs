import { episodeCode, libraryGroupId } from "./library-episodes.mjs";

const seriesPractice = /^\/[a-z0-9-]+-(tt\d{5,12})\/(s(\d{2,3})e(\d{2,4}))\/practice\/?$/;
const moviePractice = /^\/[a-z0-9-]+\/[a-z0-9-]+-(tt\d{5,12})\/practice\/?$/;

export function unsupportedPracticeMessage(row) {
  return `Practice for this ${row?.type === "movie" ? "movie" : "episode"} isn’t supported yet.`;
}

function slug(name, fallback) {
  return name.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;
}

export function titlePracticePath(row) {
  if (row.type === "movie") {
    return `/${slug(row.show, "movies")}/${slug(row.title, "movie")}-${row.id}/practice`;
  }
  const episode = episodeCode(row.season, row.episode).toLowerCase();
  return `/${slug(row.show, "series")}-${libraryGroupId(row)}/${episode}/practice`;
}

export function parsePracticePath(pathname) {
  const series = seriesPractice.exec(pathname);
  if (series) {
    const [, show, code, season, episode] = series;
    if (Number(episode) > 0) return { pathname, show, code, id: `${show}:${Number(season)}:${Number(episode)}` };
    return null;
  }
  const movie = moviePractice.exec(pathname);
  return movie ? { pathname, show: movie[1], id: movie[1] } : null;
}

export async function loadPracticeTitle(route, { fetcher = fetch, signal } = {}) {
  const query = new URLSearchParams({ show: route.show });
  if (route.code) query.set("search", route.code);
  let publication;
  const cursors = new Set();
  do {
    const response = await fetcher(`/api/browse?${query}`, { signal, cache: "no-store" });
    const revision = response.headers.get("X-Yomiru-Publication");
    if (!response.ok || !revision || (publication && publication !== revision)) {
      throw new Error("Could not load this title from the subtitle library.");
    }
    publication = revision;
    const { rows, nextCursor } = await response.json();
    if (!Array.isArray(rows) || (nextCursor !== null && typeof nextCursor !== "string")) {
      throw new Error("Could not verify this title.");
    }
    const row = rows.find(row => row.id === route.id);
    if (row || !nextCursor) return { publication, title: row ?? null };
    if (cursors.has(nextCursor) || cursors.size >= 350) throw new Error("Could not verify this title.");
    cursors.add(nextCursor);
    query.set("cursor", nextCursor);
  } while (true);
}
