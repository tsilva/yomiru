import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createAdminExecutor, preparePublication } from "./upload-library.mjs";
import { prepareIncrementalEpisode } from "../lib/incremental-publication.mjs";
import { sourceArchiveObject, verifySourceArchive } from "../lib/source-archive.mjs";

const hash = /^[a-f0-9]{64}$/;

async function stageArchive(archiveDirectory, archiveManifest) {
  if (!hash.test(archiveManifest)) throw new Error("Supply the private source archive manifest SHA-256");
  const archiveAssets = new Map();
  const readArchive = async (key, limit) => {
    if (!sourceArchiveObject(key)) throw new Error("Invalid private source archive path");
    const file = path.join(archiveDirectory, key);
    const metadata = await lstat(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > limit) {
      throw new Error("Invalid private source archive file");
    }
    const bytes = await readFile(file);
    archiveAssets.set(key, bytes);
    return bytes;
  };
  const manifestPath = `manifests/${archiveManifest}.json`;
  const bytes = await readArchive(manifestPath, 65536);
  const manifest = { path: manifestPath, sha256: archiveManifest, bytes: bytes.length };
  return { archiveAssets, manifest, readArchive };
}

export async function stageEpisode(directory, archiveDirectory, archiveManifest, { fetcher = fetch, wordId } = {}) {
  if (wordId !== undefined && !/^ja-[a-f0-9]{64}$/.test(wordId)) throw new Error("Invalid reviewed word ID");
  const { archiveAssets, manifest, readArchive } = await stageArchive(archiveDirectory, archiveManifest);
  const publicBundle = await preparePublication(directory, fetcher);
  const episode = await prepareIncrementalEpisode(publicBundle.bytes, publicBundle.pointer.sha256, manifest, {
    readAsset: pathname => publicBundle.assets.get(pathname), readArchive, exactVocabulary: Boolean(wordId),
  });
  return { publicBundle, archiveAssets, manifest, episode, wordId };
}

async function uploadArchiveObjects(archiveAssets, admin) {
  for (const [pathname, bytes] of archiveAssets) {
    const result = await admin({ incremental: { action: "private-object", path: pathname,
      content: bytes.toString("base64") } });
    if (result.sha256 !== path.basename(pathname).split(".")[0]) throw new Error("Private upload was unconfirmed");
  }
}

export async function backfillSource(videoId, archiveDirectory, archiveManifest, admin) {
  const { archiveAssets, manifest, readArchive } = await stageArchive(archiveDirectory, archiveManifest);
  const { anchor } = await admin({ incremental: { action: "archive-target", videoId } });
  await verifySourceArchive(manifest, anchor, null, readArchive);
  await uploadArchiveObjects(archiveAssets, admin);
  const result = await admin({ incremental: { action: "attach-archive", videoId, manifest } });
  if (result.sha256 !== manifest.sha256 || typeof result.unchanged !== "boolean") {
    throw new Error("Source archive attachment was unconfirmed");
  }
  return result;
}

export async function uploadEpisode(staged, admin) {
  const { state } = await admin({ incremental: { action: "state" } });
  if (!state?.serving || !hash.test(state.catalogueRevision)) throw new Error("Incremental publishing is unavailable");
  const { publicBundle, archiveAssets, manifest, wordId } = staged;
  await uploadArchiveObjects(archiveAssets, admin);
  const assets = new Map(publicBundle.assets);
  assets.set(publicBundle.pointer.path, publicBundle.bytes);
  for (const [pathname, bytes] of assets) {
    const result = await admin({ path: pathname, content: bytes.toString("base64") });
    if (result.sha256 !== path.basename(pathname).split(".")[0]) throw new Error("Public upload was unconfirmed");
  }
  const result = await admin({ incremental: { action: wordId ? "correct-vocabulary" : "publish",
    previous: state.catalogueRevision,
    pointer: publicBundle.pointer, manifest, ...(wordId && { wordId }) } });
  if (!hash.test(result.revision) || typeof result.unchanged !== "boolean") {
    throw new Error("Episode activation was unconfirmed");
  }
  return result;
}

async function main() {
  const { values } = parseArgs({ options: {
    "library-dir": { type: "string" }, "archive-dir": { type: "string" }, "archive-manifest": { type: "string" },
    "dry-run": { type: "boolean" }, "correct-word-id": { type: "string" }, "existing-video-id": { type: "string" },
    deployment: { type: "string" }, executor: { type: "string" },
  } });
  if (!values["archive-dir"]) throw new Error("Supply the private archive directory");
  if (values["existing-video-id"]) {
    if (values["library-dir"] || values["correct-word-id"] || values["dry-run"]) {
      throw new Error("Archive attachment only requires the existing video ID, archive and executor");
    }
    const result = await backfillSource(values["existing-video-id"], path.resolve(values["archive-dir"]),
      values["archive-manifest"], createAdminExecutor(values.executor, values.deployment));
    console.log(JSON.stringify(result));
    return;
  }
  if (!values["library-dir"]) throw new Error("Supply the episode directory");
  const staged = await stageEpisode(path.resolve(values["library-dir"]), path.resolve(values["archive-dir"]),
    values["archive-manifest"], { wordId: values["correct-word-id"] });
  const result = values["dry-run"] ? { valid: true, tracks: staged.episode.tracks.length }
    : await uploadEpisode(staged, createAdminExecutor(values.executor, values.deployment));
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
