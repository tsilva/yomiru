import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { validateIndex, validateAsset } from "../lib/library.mjs";
import { coveredShows, metadataSnapshot, validateSnapshot } from "../lib/catalogue.mjs";
import { storage, validatePointer, decodePublication } from "../lib/published-library.mjs";
import { readBlobPublication } from "../lib/r2-publication.mjs";
import { readPublic, preserveCoverage, retainPublishedVocabulary } from "../lib/publication-io.mjs";
import { validateVocabularyAsset, validateRegistryAsset, resolveVocabulary, mergeRegistries, encodeRegistry } from "../lib/vocabulary.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const web = fileURLToPath(new URL("../", import.meta.url));

export { readPublic, preserveCoverage } from "../lib/publication-io.mjs";

export async function preparePublication(directory, fetcher = fetch) {
  const indexPath = path.join(directory, "index.json");
  if ((await lstat(indexPath)).isSymbolicLink()) throw new Error("Library index cannot be a symlink");
  const index = validateIndex(JSON.parse(await readFile(indexPath, "utf8")));
  if (!/^[a-f0-9]{64}$/.test(index.revision)) throw new Error("Missing library revision");
  const assets = new Map();
  let registry;
  if (index.registry) {
    const localPath = path.join(directory, path.basename(index.registry.path));
    const stat = await lstat(localPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 3 * 1024 * 1024) throw new Error("Invalid master vocabulary asset");
    const bytes = await readFile(localPath);
    registry = validateRegistryAsset(index.registry, bytes);
    assets.set(index.registry.path, bytes);
  }
  for (const track of index.tracks) {
    const localPath = path.join(directory, `${track.sha256}.ass`);
    const stat = await lstat(localPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 3 * 1024 * 1024) {
      throw new Error("Invalid local subtitle asset");
    }
    const bytes = await readFile(localPath);
    validateAsset(track, bytes);
    assets.set(track.path, bytes);
  }
  for (const entry of index.vocabulary || []) {
    const file = path.join(directory, path.basename(entry.path));
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 3 * 1024 * 1024) {
      throw new Error("Invalid local vocabulary asset");
    }
    const bytes = await readFile(file);
    const document = validateVocabularyAsset(entry, bytes);
    if (registry || document.version === 2) resolveVocabulary(document, registry);
    assets.set(entry.path, bytes);
  }
  const shows = {};
  for (const [showId, episodes] of coveredShows(index)) {
    const result = await readPublic(
      `https://v3-cinemeta.strem.io/meta/series/${showId}.json`, fetcher, 4 * 1024 * 1024,
    );
    if (!result) throw new Error("Missing catalogue show metadata");
    shows[showId] = metadataSnapshot(JSON.parse(result.bytes).meta, showId);
    for (const episode of episodes.values()) {
      const original = shows[showId].videos.find(video => video.id === episode.id);
      if (!original?.title?.trim()) {
        throw new Error(`Missing catalogue episode metadata: ${episode.id}`);
      }
    }
  }
  const catalogue = validateSnapshot({ version: 1, libraryRevision: index.revision, shows }, index);
  const bytes = Buffer.from(JSON.stringify({ version: 1, index, catalogue }));
  if (bytes.length > 3 * 1024 * 1024) throw new Error("Library snapshot exceeds the 3 MiB upload limit");
  const digest = sha(bytes);
  const pointer = { version: 1, sha256: digest, path: `/library/snapshots/${digest}.json` };
  decodePublication(bytes, digest);
  return { index, catalogue, assets, bytes, pointer };
}

export async function verifyUploadedObject(url, bytes, {
  fetcher = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  // A newly written public blob can briefly return a cached 404. Only that
  // anonymous read is retried; mismatches and authenticated writes fail at once.
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const stored = await readPublic(url, fetcher);
    if (stored) {
      if (!stored.bytes.equals(bytes)) throw new Error("Uploaded object integrity check failed");
      return;
    }
    if (attempt < 6) await pause(Math.min(1000 * 2 ** attempt, 8000));
  }
  throw new Error("Uploaded object did not become publicly readable; current publication was not changed");
}

export async function uploadPublication(prepared, { fetcher = fetch, put, pause, updateRegistry = false,
  origin = storage.origin, readCurrent = () => readPublic(`${origin}${storage.pointer}`, fetcher, 4096),
} = {}) {
  const current = await readCurrent();
  let previousPointer;
  if (current) {
    previousPointer = validatePointer(JSON.parse(current.bytes));
    if (!current.etag) throw new Error("Missing storage ETag; refusing unsafe overwrite");
    if (previousPointer.sha256 === prepared.pointer.sha256) {
      return { publication: prepared.pointer.sha256, unchanged: true, tracks: prepared.index.tracks.length };
    }
    const snapshot = await readPublic(`${origin}${previousPointer.path}`, fetcher);
    if (!snapshot) throw new Error("Current library snapshot is missing");
    const previousIndex = decodePublication(snapshot.bytes, previousPointer.sha256).index;
    const retained = retainPublishedVocabulary(previousIndex, prepared.index);
    if (previousIndex.registry) {
      const previousFile = await readPublic(`${origin}${previousIndex.registry.path}`, fetcher, 3 * 1024 * 1024);
      if (!previousFile) throw new Error("Current master vocabulary is missing");
      const previousRegistry = validateRegistryAsset(previousIndex.registry, previousFile.bytes);
      const incomingBytes = prepared.index.registry && prepared.assets.get(prepared.index.registry.path);
      const incomingRegistry = incomingBytes ? validateRegistryAsset(prepared.index.registry, incomingBytes) : null;
      const merged = mergeRegistries(previousRegistry, incomingRegistry, updateRegistry);
      const { bytes, descriptor } = encodeRegistry(merged);
      retained.registry = descriptor;
      if (prepared.index.registry && retained.registry.path !== prepared.index.registry.path) prepared.assets.delete(prepared.index.registry.path);
      prepared.assets.set(retained.registry.path, bytes);
    }
    if (JSON.stringify(retained) !== JSON.stringify(prepared.index)) {
      retained.revision = sha(Buffer.from(JSON.stringify({ tracks: retained.tracks, vocabulary: retained.vocabulary, registry: retained.registry })));
      const catalogue = { ...prepared.catalogue, libraryRevision: retained.revision };
      const bytes = Buffer.from(JSON.stringify({ version: 1, index: retained, catalogue }));
      if (bytes.length > 3 * 1024 * 1024) throw new Error("Library snapshot exceeds the 3 MiB upload limit");
      const checksum = sha(bytes);
      prepared = { ...prepared, index: retained, catalogue, bytes,
        pointer: { version: 1, sha256: checksum, path: `/library/snapshots/${checksum}.json` } };
      decodePublication(bytes, checksum);
    }
    preserveCoverage(previousIndex, prepared.index);
  }
  for (const [assetPath, bytes] of prepared.assets) {
    const existing = await readPublic(`${origin}${assetPath}`, fetcher, 4 * 1024 * 1024);
    if (existing) {
      if (!existing.bytes.equals(bytes)) throw new Error("Existing immutable asset differs");
    } else {
      await put(assetPath, bytes, assetPath.endsWith(".ass") ? "text/x-ssa; charset=utf-8" : assetPath.endsWith(".gz") ? "application/gzip" : "application/json", 31536000);
      await verifyUploadedObject(`${origin}${assetPath}`, bytes, { fetcher, pause });
    }
  }
  const snapshotPath = prepared.pointer.path;
  const existing = await readPublic(`${origin}${snapshotPath}`, fetcher);
  if (existing && !existing.bytes.equals(prepared.bytes)) throw new Error("Immutable snapshot differs");
  if (!existing) {
    await put(snapshotPath, prepared.bytes, "application/json", 31536000);
    await verifyUploadedObject(`${origin}${snapshotPath}`, prepared.bytes, { fetcher, pause });
  }
  if (previousPointer?.sha256 === prepared.pointer.sha256) {
    return { publication: prepared.pointer.sha256, unchanged: true, tracks: prepared.index.tracks.length };
  }
  // Commit only after every referenced object is complete. The ETag rejects a concurrent publisher.
  await put(storage.pointer, Buffer.from(JSON.stringify(prepared.pointer)), "application/json", 60,
    current ? { overwrite: true, etag: current.etag } : {});
  return { publication: prepared.pointer.sha256, unchanged: false, tracks: prepared.index.tracks.length };
}

export function createAdminExecutor(executable, deployment) {
  if (typeof executable !== "string" || !path.isAbsolute(executable)) {
    throw new Error("Supply the absolute path of the approved publication executor with --executor");
  }
  if (typeof deployment !== "string" || !/^yomiru-[a-z0-9]+-tsilvas-projects\.vercel\.app$/.test(deployment)) {
    throw new Error("Supply the protected Yomiru deployment hostname with --deployment");
  }
  const url = `https://${deployment}/api/admin-publish`;
  return body => {
    const request = body === undefined ? { method: "GET", url } : { method: "POST", url, body };
    const input = JSON.stringify(request);
    if (Buffer.byteLength(input) > 4 * 1024 * 1024) throw new Error("Publication request exceeds executor limit");
    try {
      const result = spawnSync(executable, [], { cwd: path.resolve(web, ".."), input,
        encoding: "utf8", timeout: 65000, maxBuffer: 64 * 1024 });
      if (result.status === 0) {
        const response = JSON.parse(result.stdout);
        if (response?.status === 200 && response.body && typeof response.body === "object"
          && !Array.isArray(response.body)) return response.body;
      }
    } catch {
      // Private executor diagnostics stay outside publisher output.
    }
    throw new Error("Protected publication request failed through the configured executor");
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    "library-dir": { type: "string", default: path.join(web, "../.local/published") },
    "dry-run": { type: "boolean", default: false },
    "deployment": { type: "string" },
    executor: { type: "string" },
    "update-registry": { type: "boolean", default: false },
    r2: { type: "boolean", default: false },
    "migrate-from-blob": { type: "boolean", default: false },
  } });
  const migrate = values["migrate-from-blob"];
  if (migrate && (!values.r2 || values["update-registry"])) {
    throw new Error("Legacy migration requires --r2 and preserves the published registry");
  }
  const admin = values["dry-run"] ? null : createAdminExecutor(values.executor, values.deployment);
  const prepared = migrate ? { ...await readBlobPublication(), assets: new Map() }
    : await preparePublication(path.resolve(values["library-dir"]));
  if (values["dry-run"]) {
    console.log(JSON.stringify({ valid: true, tracks: prepared.index.tracks.length,
      publication: prepared.pointer.sha256, backend: values.r2 ? "r2" : "blob" }));
    return;
  }
  const put = (pathname, bytes, contentType, maxAge, options = {}) =>
    admin({ path: pathname, content: bytes.toString("base64"), ...options });
  let target;
  if (values.r2) {
    target = await admin();
    const url = new URL(target.origin);
    if (url.protocol !== "https:" || url.origin !== target.origin
      || !(target.revision === null || /^[a-f0-9]{64}$/.test(target.revision))) {
      throw new Error("Invalid R2 publication target");
    }
  }
  if (migrate) {
    if (target.revision && target.revision !== prepared.pointer.sha256) {
      throw new Error("Legacy snapshot differs from the active Neon publication");
    }
  }
  if (migrate && !target.revision) {
    for (const phase of ["objects", "links", "votes"]) {
      let cursor;
      let imported = 0;
      const seen = new Set();
      do {
        const page = await admin({ import: { phase, cursor } });
        if (!Number.isSafeInteger(page.imported) || page.imported < 0
          || !(page.cursor === null || typeof page.cursor === "string")) throw new Error("Invalid import page");
        imported += page.imported;
        cursor = page.cursor;
        if (cursor && seen.has(cursor)) throw new Error("Legacy import pagination repeated");
        seen.add(cursor);
      } while (cursor);
      console.log(JSON.stringify({ phase, imported }));
    }
  }
  const options = target ? {
    origin: target.origin,
    readCurrent: async () => {
      const revision = (await admin()).revision;
      if (!revision) return null;
      const pointer = validatePointer({ version: 1, sha256: revision, path: `/library/snapshots/${revision}.json` });
      return { bytes: Buffer.from(JSON.stringify(pointer)), etag: `"${revision}"` };
    },
  } : {};
  console.log(JSON.stringify(await uploadPublication(prepared, { ...options, put, updateRegistry: values["update-registry"] })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
