import { createHash } from "node:crypto";
import { validateArtworkAsset } from "./episode-artwork.mjs";
import { fileURLToPath } from "node:url";
import { activateLegacyPublication, createPublicationStore } from "./database.mjs";
import { libraryRows } from "./browse.mjs";
import { legacyRecoveryPackage } from "./incremental-recovery.mjs";
import { createIncrementalStore, prepareIncrementalBaseline, prepareIncrementalEpisode } from "./incremental-publication.mjs";
import { validateAsset } from "./library.mjs";
import { renderPlaybackTrack } from "./playback-ass.mjs";
import { linkJmdictPage } from "./jmdict.mjs";
import { validatePointer } from "./published-library.mjs";
import { archiveReadinessPath } from "./r2.mjs";
import { loadPublicationRows, mapBatches } from "./r2-publication.mjs";
import { sourceArchiveObject, verifySourceArchive } from "./source-archive.mjs";
import { validateVocabularyAsset } from "./vocabulary.mjs";
import { createWordReviewStore } from "./word-review.mjs";

const hash = /^[a-f0-9]{64}$/;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const migration = fileURLToPath(new URL("../db/incremental.sql", import.meta.url));
const servingMigration = fileURLToPath(new URL("../db/serving.sql", import.meta.url));
const practiceMigration = fileURLToPath(new URL("../db/practice-postings.sql", import.meta.url));
const practiceBandsMigration = fileURLToPath(new URL("../db/practice-bands.sql", import.meta.url));
const archiveProbe = Buffer.from("Yomiru private archive readiness check\n");

function reader(objects) {
  return async (path, limit = 3 * 1024 * 1024) => {
    const key = path.startsWith("/") ? path.slice(1) : path;
    const object = await objects.read(key, limit);
    if (!object) throw new Error("Publication asset is missing");
    return object.bytes;
  };
}

async function preparePlaybackTrack(track, objects, readAsset) {
  const original = await readAsset(track.path, track.bytes);
  validateAsset(track, original);
  const bytes = renderPlaybackTrack(original);
  if (bytes.length > 4 * 1024 * 1024) throw new Error("Playback subtitle exceeds the asset limit");
  const sha256 = digest(bytes);
  const path = `/library/${sha256}.ass`;
  if (path !== track.path) {
    await objects.put(path.slice(1), bytes, { contentType: "text/x-ssa; charset=utf-8" });
    if (!(await readAsset(path, bytes.length)).equals(bytes)) throw new Error("Playback asset could not be verified");
  }
  return { ...track, id: digest(JSON.stringify(["playback", track.id, sha256])),
    path, sha256, bytes: bytes.length, playbackReady: true };
}

async function writePrivateObject({ path, content }, store) {
  if (typeof content !== "string" || content.length > 4 * 1024 * 1024 || !sourceArchiveObject(path)
    || content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
    throw new Error("Invalid private archive upload");
  }
  const bytes = Buffer.from(content, "base64");
  const sha256 = digest(bytes);
  if (!bytes.length || !path.split("/")[1].startsWith(`${sha256}.`)) {
    throw new Error("Private archive content address does not match");
  }
  const contentType = path.endsWith(".gz") ? "application/gzip" : "application/octet-stream";
  await store.put(path, bytes, { contentType });
  const verified = await reader(store)(path, bytes.length);
  if (!verified.equals(bytes)) throw new Error("Private archive object could not be verified");
  return { sha256 };
}

async function recoverLegacy(store, objects, expected) {
  if (!hash.test(expected)) throw new Error("Invalid recovery revision");
  const recovery = await legacyRecoveryPackage(store, expected);
  const readAsset = reader(objects);
  const rows = await loadPublicationRows(recovery.index, pathname => recovery.assets.get(pathname));
  await mapBatches([...new Map(recovery.index.tracks.map(track => [track.path, track])).values()], async track => {
    validateAsset(track, await readAsset(track.path, track.bytes));
  });
  await mapBatches(recovery.index.artwork ?? [], async item => {
    validateArtworkAsset(item, await readAsset(item.path, item.bytes));
  });
  await mapBatches([...recovery.assets], async ([pathname, bytes]) => {
    const key = pathname.slice(1);
    await objects.put(key, bytes, { contentType: pathname.endsWith(".gz") ? "application/gzip" : "application/json" });
    if (!(await readAsset(pathname, bytes.length)).equals(bytes)) throw new Error("Recovery asset could not be verified");
  });
  const revision = recovery.pointer.sha256;
  const changed = await store.restoreLegacy(expected, revision, (tx, previous) => activateLegacyPublication(tx, {
    revision, expected: previous, snapshot: recovery.bytes, ...rows, tracks: recovery.index.tracks,
    catalogueRows: libraryRows(recovery.index, recovery.catalogue),
  }));
  return { revision, unchanged: !changed };
}

export async function incrementalAdmin(body, { sql, publicAssets, privateAssets }) {
  const store = createIncrementalStore(sql);
  const readAsset = reader(publicAssets);
  switch (body?.action) {
    case "bootstrap": {
      if (!hash.test(body.revision)) throw new Error("Invalid baseline revision");
      const legacy = createPublicationStore(sql);
      if (await legacy.current() !== body.revision) throw new Error("Legacy publication changed");
      const snapshot = await legacy.snapshot(body.revision);
      const baseline = await prepareIncrementalBaseline(snapshot, body.revision, readAsset);
      const connection = await sql.reserve();
      try {
        await connection.file(migration);
        await connection.file(servingMigration);
        await connection.file(practiceMigration);
        await connection.file(practiceBandsMigration);
      }
      finally { connection.release(); }
      return { initialized: await store.bootstrap(baseline), state: await store.state() };
    }
    case "state":
      return { state: await store.state() };
    case "parity":
      if (!hash.test(body.revision)) throw new Error("Invalid baseline revision");
      return store.baselineParity(body.revision);
    case "cutover":
      if (body.serving === true) {
        const archive = privateAssets();
        await archive.put(archiveReadinessPath, archiveProbe, { contentType: "text/plain" });
        const verified = await reader(archive)(archiveReadinessPath, archiveProbe.length);
        if (!verified.equals(archiveProbe)) throw new Error("Private source archive readiness check failed");
      }
      return { changed: await store.setServing(body.revision, body.serving), state: await store.state() };
    case "private-object":
      return writePrivateObject(body, privateAssets());
    case "recover-legacy":
      return recoverLegacy(store, publicAssets, body.revision);
    default:
      if (!(await store.state())?.serving) throw new Error("Incremental publishing is paused");
  }
  switch (body.action) {
    case "migrate-playback-tracks":
      return store.migratePlaybackTracks(body.trackIds, body.previous,
        track => preparePlaybackTrack(track, publicAssets, readAsset));
    case "purge-superseded-tracks": {
      const result = await store.purgeSupersededTracks(body.trackIds, body.previous);
      await mapBatches(result.keys, key => publicAssets.deleteSubtitle(key));
      return result;
    }
    case "purge-legacy-playback": {
      await store.requirePlaybackCutover(body.previous);
      const keys = await publicAssets.legacyPlaybackKeys();
      await mapBatches(keys, key => publicAssets.deleteSubtitle(key));
      return { keys };
    }
    case "retire-movie-tracks":
      return store.retireMovieTracks(body.videoId, body.trackIds, body.previous);
    case "withdraw-movie-tracks":
      return store.retireMovieTracks(body.videoId, body.trackIds, body.previous, { withdraw: true });
    case "purge-retired-movie-romaji": {
      const { keys, ...receipt } = await store.purgeRetiredMovieRomaji(body.videoId, body.trackId, body.previous);
      await mapBatches(keys, key => publicAssets.deleteSubtitle(key));
      return { ...receipt, assets: keys };
    }
    case "archive-target":
      return store.archiveTarget(body.videoId);
    case "attach-archive": {
      const { anchor } = await store.archiveTarget(body.videoId);
      const source = await verifySourceArchive(body.manifest, anchor, null, reader(privateAssets()));
      return store.attachArchive(body.videoId, source);
    }
    case "publish":
    case "preflight-episode":
    case "correct-vocabulary": {
      const pointer = validatePointer(body.pointer);
      const snapshot = await readAsset(pointer.path);
      const episode = await prepareIncrementalEpisode(snapshot, pointer.sha256, body.manifest, {
        readAsset, readArchive: reader(privateAssets()), exactVocabulary: body.action === "correct-vocabulary",
      });
      return body.action === "correct-vocabulary" ? store.correctVocabulary(episode, body.previous, body.wordId)
        : store.publishEpisode(episode, body.previous, { preflight: body.action === "preflight-episode", reviewId: body.reviewId });
    }
    case "study-vocabulary": {
      if (!Array.isArray(body.items) || !body.items.length || body.items.length > 64) {
        throw new Error("Supply a bounded batch of vocabulary cleanup assets");
      }
      const staged = await mapBatches(body.items, async ({ vocabulary, manifest, previousVocabulary }) => {
        const { anchor, sha256, path, bytes, words, videoIds, analysis } = vocabulary;
        if (!hash.test(previousVocabulary) || !hash.test(anchor) || !hash.test(sha256)
          || path !== `/library/${sha256}.vocabulary.json`
          || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > 3 * 1024 * 1024
          || !Array.isArray(videoIds) || !videoIds.length || videoIds.length > 32
          || videoIds.some(id => typeof id !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(id))) {
          throw new Error("Invalid cleanup vocabulary descriptor");
        }
        const descriptor = { anchor, sha256, path, bytes, words, videoIds, analysis };
        const document = validateVocabularyAsset(descriptor, await readAsset(path, bytes));
        if (document.version !== 2 || document.analysis !== analysis) {
          throw new Error("Cleanup requires a shared-registry vocabulary asset");
        }
        const { counts, ...source } = await verifySourceArchive(manifest, anchor, null, reader(privateAssets()));
        if (counts.size !== document.words.length || document.words.some(word => counts.get(word.id) !== word.count)) {
          throw new Error("Cleanup vocabulary must match the exact archived token counts");
        }
        const { words: occurrences, ...header } = document;
        return { descriptor, source, occurrences, header, previousVocabulary };
      });
      return store.cleanStudyVocabulary(staged, body.previous);
    }
    case "seed-jmdict":
      return { inserted: await store.seedJmdict(body.rows) };
    case "link-jmdict":
      return linkJmdictPage(sql, body.after);
    case "enqueue-reviews":
      return { enqueued: await createWordReviewStore(sql).enqueueUnresolved() };
    case "review-claim":
      return { job: await createWordReviewStore(sql).claim() };
    case "review-finish":
      return createWordReviewStore(sql).finish(body.job, body.answer);
    default:
      throw new Error("Unknown incremental publication action");
  }
}
