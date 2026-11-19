import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { metadataSnapshot } from "./catalogue.mjs";
import { readPublic } from "./publication-io.mjs";

export const defaultCinemetaCacheDir = fileURLToPath(new URL("../../.local/cinemeta/", import.meta.url));
const sourceLimit = 4 * 1024 * 1024;
const cacheLimit = 8 * 1024 * 1024;
const checksum = data => createHash("sha256").update(data).digest("hex");

function missingEpisode(metadata, episodeIds) {
  return episodeIds.find(id => !metadata.videos.find(video => video.id === id)?.title?.trim());
}

async function readEntry(filename, { type, id, sourceUrl }) {
  let entry;
  try {
    const stat = await lstat(filename);
    if (!stat.isFile()) throw new Error(`Invalid Cinemeta cache file: ${filename}`);
    if (stat.size > cacheLimit) return null;
    entry = JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
  if (entry?.version !== 1 || entry.type !== type || entry.id !== id
    || entry.sourceUrl !== sourceUrl || typeof entry.fetchedAt !== "string"
    || !Number.isFinite(Date.parse(entry.fetchedAt)) || !entry.metadata) return null;
  const stored = JSON.stringify(entry.metadata);
  if (checksum(stored) !== entry.sha256) return null;
  try {
    const verified = metadataSnapshot(entry.metadata, id, type);
    return JSON.stringify(verified) === stored ? entry : null;
  } catch {
    return null;
  }
}

async function writeEntry(filename, entry) {
  const data = JSON.stringify(entry) + "\n";
  if (Buffer.byteLength(data) > cacheLimit) throw new Error("Cinemeta cache entry exceeds size limit");
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function createCinemetaCache(directory = defaultCinemetaCacheDir, fetcher = fetch) {
  return {
    async get(type, id, { episodeIds = [], refresh = false } = {}) {
      if (!["movie", "series"].includes(type) || typeof id !== "string" || !/^tt\d{5,12}$/.test(id)
        || (type === "movie" && episodeIds.length)) throw new Error("Invalid Cinemeta title identity");
      const sourceUrl = `https://v3-cinemeta.strem.io/meta/${type}/${id}.json`;
      const filename = path.join(directory, type, `${id}.json`);
      const cached = refresh ? null : await readEntry(filename, { type, id, sourceUrl });
      if (cached && !missingEpisode(cached.metadata, episodeIds)) return cached;

      const result = await readPublic(sourceUrl, fetcher, sourceLimit);
      if (!result) throw new Error(`Missing catalogue ${type === "series" ? "show" : "movie"} metadata: ${id}`);
      const metadata = metadataSnapshot(JSON.parse(result.bytes).meta, id, type);
      const missing = missingEpisode(metadata, episodeIds);
      if (missing) throw new Error(`Missing catalogue episode metadata: ${missing}`);
      const entry = {
        version: 1, type, id, sourceUrl, fetchedAt: new Date().toISOString(),
        sha256: checksum(JSON.stringify(metadata)), metadata,
      };
      await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      await writeEntry(filename, entry);
      return entry;
    },
  };
}
