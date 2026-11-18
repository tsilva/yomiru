import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { validateIndex } from "./library.mjs";
import { validateSnapshot } from "./catalogue.mjs";
import { databaseEnabled, r2Origin } from "./storage-config.mjs";
import { publicationStore } from "./database.mjs";

export const storage = JSON.parse(readFileSync(new URL("../library-storage.json", import.meta.url), "utf8"));
const hashPattern = /^[a-f0-9]{64}$/;
const maxBytes = 16 * 1024 * 1024;

export function validatePointer(pointer) {
  if (pointer?.version !== 1 || !hashPattern.test(pointer.sha256)
    || pointer.path !== `/library/snapshots/${pointer.sha256}.json`) {
    throw new Error("Invalid library pointer");
  }
  return pointer;
}

export function decodePublication(bytes, expectedHash) {
  if (bytes.length > maxBytes || createHash("sha256").update(bytes).digest("hex") !== expectedHash) {
    throw new Error("Library snapshot integrity check failed");
  }
  const publication = JSON.parse(bytes.toString("utf8"));
  if (publication.version !== 1) throw new Error("Unknown library publication version");
  const index = validateIndex(publication.index);
  const catalogue = validateSnapshot(publication.catalogue, index);
  return { index, catalogue, publication: expectedHash };
}

export function assetUrl(path) {
  if (!/^\/library\/[a-f0-9]{64}\.(?:ass|vocabulary\.json|registry\.json(?:\.gz)?)$/.test(path)) throw new Error("Invalid library asset path");
  return `${publishedAssetOrigin()}${path}`;
}

export function publishedAssetOrigin() {
  return databaseEnabled() ? r2Origin() : storage.origin;
}

async function boundedGet(url, fetcher, limit) {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(10000), redirect: "error", cache: "no-store",
  });
  if (!response.ok) throw new Error(`Library request failed (${response.status})`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error("Library response exceeds size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Refresh the mutable pointer on every API request. Immutable snapshots can be reused.
// Never keep an unbounded in-process index or silently fall back to bundled data.
export function createLibraryReader(fetcher = fetch) {
  let cached;
  return async function read() {
    const pointer = validatePointer(JSON.parse(await boundedGet(
      `${storage.origin}${storage.pointer}`, fetcher, 4096,
    )));
    if (cached?.publication === pointer.sha256) return cached;
    const bytes = await boundedGet(`${storage.origin}${pointer.path}`, fetcher, maxBytes);
    const next = decodePublication(bytes, pointer.sha256);
    cached = next;
    return next;
  };
}

export function createDatabaseReader(store) {
  let cached;
  return async () => {
    const revision = await store.current();
    if (!hashPattern.test(revision || "")) throw new Error("Published library is missing");
    if (cached?.publication === revision) return cached;
    const next = decodePublication(await store.snapshot(revision), revision);
    cached = next;
    return next;
  };
}

const readBlobLibrary = createLibraryReader();
const readDatabaseLibrary = createDatabaseReader({
  current: () => publicationStore().current(),
  snapshot: revision => publicationStore().snapshot(revision),
});

export const readPublishedLibrary = () => databaseEnabled() ? readDatabaseLibrary() : readBlobLibrary();
