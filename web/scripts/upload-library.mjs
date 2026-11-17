import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { validateIndex, validateAsset } from "../lib/library.mjs";
import { coveredShows, metadataSnapshot, validateSnapshot } from "../lib/catalogue.mjs";
import { storage, validatePointer, decodePublication } from "../lib/published-library.mjs";
import { readPublic, preserveCoverage } from "../lib/publication-io.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const web = fileURLToPath(new URL("../", import.meta.url));

export { readPublic, preserveCoverage } from "../lib/publication-io.mjs";

export async function preparePublication(directory, fetcher = fetch) {
  const indexPath = path.join(directory, "index.json");
  if ((await lstat(indexPath)).isSymbolicLink()) throw new Error("Library index cannot be a symlink");
  const index = validateIndex(JSON.parse(await readFile(indexPath, "utf8")));
  if (!/^[a-f0-9]{64}$/.test(index.revision)) throw new Error("Missing library revision");
  const assets = new Map();
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
  const shows = {};
  for (const showId of coveredShows(index).keys()) {
    const result = await readPublic(
      `https://v3-cinemeta.strem.io/meta/series/${showId}.json`, fetcher, 4 * 1024 * 1024,
    );
    if (!result) throw new Error("Missing catalogue show metadata");
    shows[showId] = metadataSnapshot(JSON.parse(result.bytes).meta, showId);
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

export async function uploadPublication(prepared, { fetcher = fetch, put, pause } = {}) {
  const current = await readPublic(`${storage.origin}${storage.pointer}`, fetcher, 4096);
  let previousPointer;
  if (current) {
    previousPointer = validatePointer(JSON.parse(current.bytes));
    if (!current.etag) throw new Error("Missing storage ETag; refusing unsafe overwrite");
    const snapshot = await readPublic(`${storage.origin}${previousPointer.path}`, fetcher);
    if (!snapshot) throw new Error("Current library snapshot is missing");
    preserveCoverage(decodePublication(snapshot.bytes, previousPointer.sha256).index, prepared.index);
  }
  for (const [assetPath, bytes] of prepared.assets) {
    const existing = await readPublic(`${storage.origin}${assetPath}`, fetcher, 4 * 1024 * 1024);
    if (existing) {
      if (!existing.bytes.equals(bytes)) throw new Error("Existing immutable asset differs");
    } else {
      await put(assetPath, bytes, "text/x-ssa; charset=utf-8", 31536000);
      await verifyUploadedObject(`${storage.origin}${assetPath}`, bytes, { fetcher, pause });
    }
  }
  const snapshotPath = prepared.pointer.path;
  const existing = await readPublic(`${storage.origin}${snapshotPath}`, fetcher);
  if (existing && !existing.bytes.equals(prepared.bytes)) throw new Error("Immutable snapshot differs");
  if (!existing) {
    await put(snapshotPath, prepared.bytes, "application/json", 31536000);
    await verifyUploadedObject(`${storage.origin}${snapshotPath}`, prepared.bytes, { fetcher, pause });
  }
  if (previousPointer?.sha256 === prepared.pointer.sha256) {
    return { publication: prepared.pointer.sha256, unchanged: true, tracks: prepared.index.tracks.length };
  }
  // Commit only after every referenced object is complete. The ETag rejects a concurrent publisher.
  await put(storage.pointer, Buffer.from(JSON.stringify(prepared.pointer)), "application/json", 60,
    current ? { overwrite: true, etag: current.etag } : {});
  return { publication: prepared.pointer.sha256, unchanged: false, tracks: prepared.index.tracks.length };
}

async function main() {
  const { values } = parseArgs({ options: {
    "library-dir": { type: "string", default: path.join(web, "../.local/published") },
    "dry-run": { type: "boolean", default: false },
    "deployment": { type: "string" },
  } });
  const prepared = await preparePublication(path.resolve(values["library-dir"]));
  if (values["dry-run"]) {
    console.log(JSON.stringify({ valid: true, tracks: prepared.index.tracks.length,
      publication: prepared.pointer.sha256, storeId: storage.storeId }));
    return;
  }
  let deployment = values.deployment;
  if (!deployment) {
    const project = spawnSync("vercel", ["api",
      "/v9/projects/prj_XOoHoudrOS7bHy5wrqPSGJivsKXM?teamId=team_eE2Iv7IMqPOx8ZVN2xNfR2f0",
      "--scope", "tsilvas-projects"], { cwd: web, encoding: "utf8", timeout: 30000 });
    if (project.status !== 0) throw new Error("Could not inspect the existing Yomiru project");
    const details = JSON.parse(project.stdout);
    if (details.id !== "prj_XOoHoudrOS7bHy5wrqPSGJivsKXM"
      || details.ssoProtection?.deploymentType !== "all_except_custom_domains") {
      throw new Error("Unexpected project or deployment protection; refusing uploads");
    }
    deployment = details.targets?.production?.url;
  }
  if (typeof deployment !== "string" || !/^yomiru-[a-z0-9]+-tsilvas-projects\.vercel\.app$/.test(deployment)) {
    throw new Error("Supply the protected Yomiru production deployment hostname");
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), "yomiru-upload-"));
  try {
    const put = async (pathname, bytes, contentType, maxAge, options = {}) => {
      const file = path.join(temporary, "upload");
      await writeFile(file, JSON.stringify({ path: pathname, content: bytes.toString("base64"), ...options }));
      const result = spawnSync("vercel", ["curl", `https://${deployment}/api/admin-publish`,
        "--scope", "tsilvas-projects", "--", "--silent", "--show-error", "--fail-with-body",
        "--request", "POST", "--header", "Content-Type: application/json", "--data-binary", `@${file}`],
      { cwd: web, encoding: "utf8", timeout: 60000 });
      if (result.status !== 0) {
        // CLI output may contain authentication details. Fail without relaying it.
        throw new Error(`Blob upload failed for ${pathname}; exit ${result.status ?? "unknown"}. No retry or credential fallback.`);
      }
    };
    console.log(JSON.stringify(await uploadPublication(prepared, { put })));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
