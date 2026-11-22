import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createAdminExecutor, preparePublication } from "./upload-library.mjs";
import { prepareIncrementalEpisode } from "../lib/incremental-publication.mjs";
import { sourceArchiveObject, verifySourceArchive } from "../lib/source-archive.mjs";
import { validateVocabularyAsset } from "../lib/vocabulary.mjs";

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

export async function stageEpisode(directory, archiveDirectory, archiveManifest, { fetcher = fetch, wordId, artwork } = {}) {
  if (wordId !== undefined && !/^ja-[a-f0-9]{64}$/.test(wordId)) throw new Error("Invalid reviewed word ID");
  const { archiveAssets, manifest, readArchive } = await stageArchive(archiveDirectory, archiveManifest);
  const publicBundle = await preparePublication(directory, fetcher, { artwork });
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

export async function uploadEpisode(staged, admin, { reviewId, preflight = false } = {}) {
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
  const candidate = { previous: state.catalogueRevision, pointer: publicBundle.pointer, manifest,
    ...(reviewId && { reviewId }) };
  if (reviewId) {
    const result = await admin({ incremental: { action: "preflight-episode", ...candidate } });
    if (result.checked !== true || result.previous !== candidate.previous || result.snapshot !== publicBundle.pointer.sha256
      || result.reviewId !== reviewId
      || !Array.isArray(result.conflicts)) throw new Error("Episode preflight was unconfirmed");
    if (preflight || result.conflicts.length) return result;
  }
  const result = await admin({ incremental: { action: wordId ? "correct-vocabulary" : "publish",
    ...candidate, ...(wordId && { wordId }) } });
  if (!hash.test(result.revision) || typeof result.unchanged !== "boolean") {
    throw new Error("Episode activation was unconfirmed");
  }
  return result;
}

export async function uploadStudyBatch(plan, directory, admin) {
  if (!Array.isArray(plan) || !plan.length || plan.length > 64) {
    throw new Error("Supply a bounded array of staged study vocabulary descriptors");
  }
  const { state } = await admin({ incremental: { action: "state" } });
  if (!state?.serving || !hash.test(state.catalogueRevision)) throw new Error("Incremental publishing is unavailable");
  for (const { vocabulary, manifest } of plan) {
    const { archiveAssets, readArchive } = await stageArchive(path.join(directory, "private"), manifest.sha256);
    const { counts } = await verifySourceArchive(manifest, vocabulary.anchor, null, readArchive);
    if (!hash.test(vocabulary.sha256) || vocabulary.path !== `/library/${vocabulary.sha256}.vocabulary.json`) {
      throw new Error("Invalid study vocabulary path");
    }
    const filename = path.join(directory, path.basename(vocabulary.path));
    const metadata = await lstat(filename);
    if (!metadata.isFile() || metadata.size > 3 * 1024 * 1024) throw new Error("Invalid study vocabulary file");
    const bytes = await readFile(filename);
    const document = validateVocabularyAsset(vocabulary, bytes);
    if (counts.size !== document.words.length || document.words.some(word => counts.get(word.id) !== word.count)) {
      throw new Error("Staged study vocabulary does not match the archive");
    }
    await uploadArchiveObjects(archiveAssets, admin);
    const result = await admin({ path: vocabulary.path, content: bytes.toString("base64") });
    if (result.sha256 !== vocabulary.sha256) throw new Error("Study vocabulary upload was unconfirmed");
  }
  const result = await admin({ incremental: { action: "study-vocabulary", previous: state.catalogueRevision, items: plan } });
  if (!hash.test(result.revision) || typeof result.unchanged !== "boolean") {
    throw new Error("Study vocabulary activation was unconfirmed");
  }
  return result;
}

async function main() {
  const { values } = parseArgs({ options: {
    "library-dir": { type: "string" }, "archive-dir": { type: "string" }, "archive-manifest": { type: "string" },
    "dry-run": { type: "boolean" }, "correct-word-id": { type: "string" }, "existing-video-id": { type: "string" },
    "study-batch": { type: "string" },
    deployment: { type: "string" }, executor: { type: "string" },
  } });
  if (values["study-batch"]) {
    if (values["archive-dir"] || values["archive-manifest"] || values["library-dir"]
      || values["correct-word-id"] || values["existing-video-id"] || values["dry-run"]) {
      throw new Error("Study cleanup takes a batch plan and executor");
    }
    const batch = path.resolve(values["study-batch"]);
    const result = await uploadStudyBatch(JSON.parse(await readFile(batch, "utf8")), path.dirname(batch),
      createAdminExecutor(values.executor, values.deployment));
    console.log(JSON.stringify(result));
    return;
  }
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
