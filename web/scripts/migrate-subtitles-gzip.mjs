import { get } from "node:https";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeStoredAss, hasGzipHeader, maxAssBytes, validAssPath } from "../lib/ass-storage.mjs";
import { subtitles, validateAsset, validateIndex } from "../lib/library.mjs";
import { mapBatches } from "../lib/publication-io.mjs";
import { subtitleCleanupBatchSize } from "../lib/subtitle-cleanup.mjs";
import { gzipMigrationAudience } from "../lib/subtitle-cleanup-identity.mjs";
import { workflowRequest } from "./workflow-request.mjs";

const site = "https://yomiru.tsilva.eu";
const assets = "https://assets.yomiru.tsilva.eu";
const request = body => workflowRequest(gzipMigrationAudience, body);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function getAsset(path, encoding) {
  return new Promise((resolve, reject) => {
    const req = get(assets + path, {
      headers: { "Accept-Encoding": encoding, Origin: site },
      signal: AbortSignal.timeout(15000),
    }, async response => {
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of response) {
          size += chunk.length;
          if (size > maxAssBytes) throw new Error("Subtitle response exceeds the size limit");
          chunks.push(chunk);
        }
        resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) });
      } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

export async function verifyGzipDelivery(track, fetchAsset = getAsset) {
  let cache;
  for (const encoding of ["gzip", "identity"]) {
    const { status, headers, body } = await fetchAsset(track.path, encoding);
    const actual = headers["content-encoding"] ?? "identity";
    if (status !== 200 || actual !== encoding || hasGzipHeader(body) !== (encoding === "gzip")
      || !/^text\/x-ssa\b/i.test(headers["content-type"] ?? "")
      || headers["access-control-allow-origin"] !== "*") {
      throw new Error(`Unexpected Cloudflare response for ${encoding} (${status}, encoding ${actual})`);
    }
    validateAsset(track, decodeStoredAss(body));
    if (encoding === "gzip") cache = headers["cf-cache-status"];
  }
  return cache;
}

async function publicJson(path) {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${site}${path}${separator}gzip-check=${Date.now()}`, {
    signal: AbortSignal.timeout(15000), redirect: "error", cache: "no-store",
  });
  if (!response.ok) throw new Error(`Public catalogue check failed (${response.status})`);
  return { value: await response.json(), revision: response.headers.get("x-yomiru-publication") };
}

async function catalogue() {
  const state = await request({ action: "status" });
  if (state?.serving !== true) throw new Error("Incremental publishing is paused");
  const { value, revision } = await publicJson("/library/index.json");
  if (revision !== state.revision) throw new Error("Public catalogue revision differs from Neon");
  const index = validateIndex(value);
  const tracks = index.tracks.filter(track => !track.superseded);
  if (!tracks.length) throw new Error("The active subtitle catalogue is empty");
  return { index, tracks, previous: state.catalogueRevision };
}

export function planFingerprint(entries) {
  const orderedEntries = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  // Neon stores the receipt as jsonb, which can reorder object keys at any depth.
  const canonical = JSON.stringify(orderedEntries, (_key, value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  });
  return createHash("sha256").update(canonical).digest("hex");
}

async function savePlan(previous, entries) {
  await writeFile(path.join(process.env.RUNNER_TEMP, "subtitle-gzip-plan.json"),
    JSON.stringify({ previous, entries }), { flag: "wx" });
  console.log(JSON.stringify({ stage: entries.length, previous, digest: planFingerprint(entries) }));
}

function requireVerified(entries) {
  if (planFingerprint(entries) !== process.env.YOMIRU_GZIP_VERIFIED_SHA256) {
    throw new Error("The staged plan differs from the locally verified fingerprint");
  }
}

async function stage(tracks, previous) {
  const batches = [];
  for (let start = 0; start < tracks.length; start += subtitleCleanupBatchSize) {
    batches.push(tracks.slice(start, start + subtitleCleanupBatchSize));
  }
  return (await mapBatches(batches, async batch => {
    const ids = batch.map(track => track.id);
    const staged = await request({ action: "stage", previous, ids });
    if (staged.previous !== previous || staged.entries?.length !== ids.length
      || ids.some(id => !staged.entries.some(entry => entry.id === id))) throw new Error("Incomplete gzip staging");
    return staged.entries;
  }, 2)).flat();
}

async function verifyPublished({ index, tracks }, { edge = false } = {}) {
  if (tracks.some(track => track.storage?.encoding !== "gzip")) throw new Error("Active plain subtitles remain");
  if (edge) await mapBatches(tracks, track => verifyGzipDelivery(track), 10);
  const videos = new Map(tracks.flatMap(track => track.videoIds.map(id => [`${track.type}/${id}`, { type: track.type, id }])));
  await mapBatches([...videos.values()], async ({ type, id }) => {
    const expected = subtitles(index, type, id, assets).map(track => track.url).sort();
    const { value } = await publicJson(`/subtitles/${type}/${id}.json`);
    if (JSON.stringify(value.subtitles?.map(track => track.url).sort()) !== JSON.stringify(expected)) {
      throw new Error("Stremio discovery differs from the active gzip catalogue");
    }
  }, 8);
  return { tracks: tracks.length, videos: videos.size, decoded: tracks.reduce((total, track) => total + track.bytes, 0),
    stored: tracks.reduce((total, track) => total + track.storage.bytes, 0) };
}

async function main(phase) {
  const before = await catalogue();
  const plain = before.tracks.filter(track => !track.storage);
  if (phase === "canary") {
    const sample = plain.find(track => track.videoIds.includes("tt8086718:1:1")) ?? plain[0];
    if (!sample) throw new Error("There is no active plain track to stage");
    await savePlan(before.previous, await stage([sample], before.previous));
    return;
  }
  if (phase === "stage") {
    await savePlan(before.previous, await stage(plain, before.previous));
    return;
  }
  if (phase === "migrate") {
    const entries = await stage(plain, before.previous);
    if (entries.length) requireVerified(entries);
    const activated = entries.length
      ? await request({ action: "activate", previous: before.previous, entries }) : { revision: before.previous, migrated: 0 };
    const current = await catalogue();
    if (activated.migrated !== entries.length || current.previous !== activated.revision
      || current.tracks.length !== before.tracks.length || before.tracks.some(track =>
        !current.tracks.some(next => next.id === track.id && next.sha256 === track.sha256))) {
      throw new Error("The gzip cutover was not confirmed");
    }
    console.log(JSON.stringify({ ...activated, ...await verifyPublished(current) }));
    return;
  }
  if (phase !== "prune") throw new Error("Choose canary, migrate, or prune");

  const verified = await verifyPublished(before);
  const { entries } = await request({ action: "receipt", previous: before.previous });
  requireVerified(entries);
  const keys = [...new Set(entries.map(entry => entry.old.key))];
  const active = new Map(before.tracks.map(track => [track.id, track]));
  if (entries.some(entry => active.get(entry.id)?.path !== entry.next.path
    || active.get(entry.id)?.sha256 !== entry.next.sha256)) throw new Error("Migrated active tracks changed");
  let deleted = 0;
  for (let offset = 0; offset < keys.length; offset += subtitleCleanupBatchSize) {
    const result = await request({ action: "prune", previous: before.previous, offset });
    const batch = keys.slice(offset, offset + subtitleCleanupBatchSize);
    const accounted = new Set([...result.deleted, ...result.absent]);
    if (result.revision !== before.previous || accounted.size !== batch.length
      || batch.some(key => !accounted.has(key))) throw new Error("Incomplete plain subtitle cleanup receipt");
    deleted += result.deleted.length;
  }
  await mapBatches(keys, async key => {
    const response = await fetch(`${site}/${key}?plain-cleanup=${Date.now()}`, {
      method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 404) throw new Error("An old plain download still resolves at the app origin");
  }, 8);
  console.log(JSON.stringify({ ...verified, verifiedAbsent: keys.length, deleted }));
}

async function verifyLocally(mode, filename) {
  const { entries } = JSON.parse(await readFile(filename, "utf8"));
  if (!Array.isArray(entries) || !entries.length || entries.some(entry => !entry?.next?.storage
    || !validAssPath(entry.next))) throw new Error("The stage plan is invalid");
  if (mode === "verify-stage") {
    let hits = (await mapBatches(entries, ({ next }) => verifyGzipDelivery(next), 10))
      .filter(cache => cache === "HIT").length;
    if (entries.length === 1 && !hits) {
      await wait(1000);
      if (await verifyGzipDelivery(entries[0].next) !== "HIT") throw new Error("The gzip canary did not reach the Cloudflare cache");
      hits = 1;
    }
    console.log(JSON.stringify({ verified: entries.length, hits, digest: planFingerprint(entries),
      ...(entries.length === 1 && { canary: assets + entries[0].next.path }) }));
  } else {
    const { value, revision } = await publicJson("/library/index.json");
    const index = validateIndex(value);
    const tracks = index.tracks.filter(track => !track.superseded);
    const active = new Map(tracks.map(track => [track.id, track]));
    if (entries.some(entry => active.get(entry.id)?.path !== entry.next.path
      || active.get(entry.id)?.sha256 !== entry.next.sha256)) throw new Error("The active library differs from the staged plan");
    console.log(JSON.stringify({ revision, ...await verifyPublished({ index, tracks }, { edge: true }),
      digest: planFingerprint(entries) }));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [mode, filename] = process.argv.slice(2);
    if (filename && ["verify-stage", "verify-live"].includes(mode)) await verifyLocally(mode, filename);
    else await main(process.env.YOMIRU_GZIP_PHASE);
  }
  catch (error) {
    console.error(error?.cause ? "The gzip migration transport failed" : error.message);
    process.exitCode = 1;
  }
}
