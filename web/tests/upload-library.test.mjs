import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { preparePublication, stageR2Publication, uploadPublication, preserveCoverage, verifyUploadedObject, createAdminExecutor } from "../scripts/upload-library.mjs";
import { createLibraryReader, decodePublication, storage } from "../lib/published-library.mjs";
import { showMetadata } from "../lib/catalogue.mjs";
import { addVocabulary, fixture } from "./library-fixture.mjs";

function bucket(initial) {
  const files = new Map();
  const writes = [];
  let etag = '"first"';
  if (initial) {
    files.set(storage.pointer, Buffer.from(JSON.stringify(initial.pointer)));
    files.set(initial.pointer.path, initial.bytes);
    for (const [pathname, bytes] of initial.assets) files.set(pathname, bytes);
  }
  return { files, writes,
    fetcher: async url => {
      assert.equal(new URL(url).origin, storage.origin);
      const bytes = files.get(new URL(url).pathname);
      return bytes ? new Response(bytes, { headers: { etag } }) : new Response("missing", { status: 404 });
    },
    put: async (pathname, bytes, type, maxAge, options = {}) => {
      if (pathname === storage.pointer && files.has(pathname)) {
        assert.equal(options.etag, etag);
        assert.equal(options.overwrite, true);
      }
      writes.push(pathname);
      files.set(pathname, bytes);
      if (pathname === storage.pointer) etag = '"second"';
    },
  };
}

test("the publisher uses only the explicit JSON executor for protected requests", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "yomiru-executor-"));
  const executable = path.join(directory, "publisher");
  const host = "yomiru-test-tsilvas-projects.vercel.app";
  try {
    await writeFile(executable, [
      "#!/usr/bin/env node",
      'const request = JSON.parse(require("node:fs").readFileSync(0, "utf8"));',
      'const body = { request, argv: process.argv.slice(2) };',
      'if (request.body?.denied) console.log(JSON.stringify({ status: 403, body: { error: "private diagnostic" } }));',
      'else console.log(JSON.stringify({ status: 200, body }));',
    ].join("\n"), { mode: 0o700 });
    const admin = createAdminExecutor(executable, host);
    const url = `https://${host}/api/admin-publish`;
    assert.deepEqual(admin(), { request: { method: "GET", url }, argv: [] });
    const body = { path: "/library/fixture", content: "dGVzdA==" };
    assert.deepEqual(admin(body), { request: { method: "POST", url, body }, argv: [] });
    assert.throws(() => admin({ denied: true }), /^Error: Protected publication request failed through the configured executor$/);
    assert.throws(() => createAdminExecutor("vercel", host), /absolute path/);
    assert.throws(() => createAdminExecutor(executable, "yomiru.tsilva.eu"), /protected Yomiru deployment/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("uploads and verifies immutable objects before committing the pointer", async () => {
  const data = fixture([1], { type: "movie", vocabulary: [1] });
  const remote = bucket();
  await uploadPublication(data, remote);
  assert.equal(remote.writes.at(-1), storage.pointer);
  assert(remote.writes.includes(data.index.vocabulary[0].path));
  assert.deepEqual(JSON.parse(remote.files.get(storage.pointer)), data.pointer);
  assert.equal((await uploadPublication(data, remote)).unchanged, true);
  assert.equal(remote.writes.filter(p => p === storage.pointer).length, 1);
});

test("new episode updates the pointer conditionally while preserving previous coverage", async () => {
  const first = fixture([1], { vocabulary: [1] }), second = fixture([1, 2], { vocabulary: [1, 2] });
  const remote = bucket(first);
  const result = await uploadPublication(second, remote);
  assert.equal(result.tracks, 2);
  assert.equal(remote.writes.at(-1), storage.pointer);
  assert.throws(() => preserveCoverage(second.index, first.index));
});

test("production staging packages only new assets and retains prior track URLs and vocabulary", async () => {
  const first = fixture([1], { vocabulary: [1] });
  const candidate = fixture();
  const old = first.index.tracks[0];
  const body = Buffer.from("[Script Info]\n; revised synthetic fixture\n");
  const sha256 = createHash("sha256").update(body).digest("hex");
  const trackPath = `/library/${sha256}.ass`;
  candidate.index.tracks[0] = {
    ...old, id: "b".repeat(64), path: trackPath, sha256, bytes: body.length,
  };
  candidate.assets = new Map([[trackPath, body]]);
  const fetcher = async (url, options) => {
    if (options.method === "HEAD") {
      assert.equal(url, "https://yomiru.tsilva.eu/library/index.json");
      return new Response(null, { headers: { "X-Yomiru-Publication": first.pointer.sha256 } });
    }
    assert.equal(url, "https://assets.yomiru.tsilva.eu" + first.pointer.path);
    return new Response(first.bytes);
  };
  const staged = await stageR2Publication(candidate, { fetcher });
  assert.equal(staged.previous, first.pointer.sha256);
  assert.deepEqual(staged.assets, { [trackPath]: body.toString("base64") });
  const { index } = decodePublication(Buffer.from(staged.snapshot, "base64"), staged.revision);
  assert.deepEqual(index.tracks, [candidate.index.tracks[0], { ...old, superseded: true }]);
  assert.deepEqual(index.vocabulary, first.index.vocabulary);
  assert.equal(await stageR2Publication(first, { fetcher }), null);
});

test("staging and upload require vocabulary for the new movie even with older gaps in the library", async () => {
  const previous = fixture([1], { type: "movie" });
  const candidate = fixture([1, 2], { type: "movie" });
  const fetcher = async (url, options) => options.method === "HEAD"
    ? new Response(null, { headers: { "X-Yomiru-Publication": previous.pointer.sha256 } })
    : new Response(previous.bytes);
  const missing = /Missing matching vocabulary for upload: tt1234562/;
  await assert.rejects(() => stageR2Publication(candidate, { fetcher }), missing);
  const remote = bucket(previous);
  await assert.rejects(() => uploadPublication(candidate, remote), missing);
  assert.deepEqual(remote.writes, []);

  const paired = fixture([1, 2], { type: "movie", vocabulary: [2] });
  const [vocabulary] = paired.index.vocabulary;
  const staged = await stageR2Publication(paired, { fetcher });
  assert.deepEqual(Object.keys(staged.assets), [vocabulary.path]);
  await uploadPublication(paired, remote);
  const { index } = decodePublication(remote.files.get(paired.pointer.path), paired.pointer.sha256);
  assert.deepEqual(index.vocabulary, [vocabulary]);
  assert.deepEqual(index.tracks[0], previous.index.tracks[0]);
});

test("new shows and episodes automatically inherit source metadata through publication and a running reader", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "yomiru-metadata-publication-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { cinemetaCacheDir: path.join(directory, "cache") };
  const data = fixture();
  await writeFile(path.join(directory, `${data.index.tracks[0].sha256}.ass`), data.body);
  const firstShow = "tt7654321", newShow = "tt9876543";
  const track = (number, videoId) => ({ ...data.index.tracks[0],
    id: String(number).padStart(64, "0"), videoIds: [videoId] });
  const initialIndex = { ...data.index, tracks: [track(1, `${firstShow}:2:3`)] };
  const nextIndex = { ...initialIndex, revision: "b".repeat(64), tracks: [
    ...initialIndex.tracks, track(2, `${firstShow}:2:4`), track(3, `${newShow}:1:8`),
  ] };
  const sources = Object.fromEntries([[firstShow, 2, [3, 4, 5]], [newShow, 1, [8, 9]]]
    .map(([id, season, episodes]) => [id, {
      id, type: "series", name: `Original series ${id}`, description: `Synopsis ${id}`,
      cast: [`Actor ${id}`], genres: ["Animation", "Drama"], imdbRating: "8.1", runtime: "25 min",
      poster: `https://example.test/${id}.png`, imdb_id: id,
      trailers: [{ source: "abcdefghijk", type: "Trailer" }],
      links: [{ name: "Original actor", category: "Cast", url: "stremio:///search?search=Original" }],
      videos: episodes.map(episode => ({ id: `${id}:${season}:${episode}`, season, episode,
        name: `Original episode ${id}/${season}/${episode}`, overview: `Original synopsis ${episode}`,
        released: "2020-01-01T00:00:00.000Z", rating: 7 + episode / 10,
        thumbnail: `https://example.test/${id}/${season}/${episode}.jpg` })),
    }]));
  const requested = [];
  const sourceFetcher = async url => {
    const id = /\/meta\/series\/(tt\d+)\.json$/.exec(url)?.[1];
    assert.equal(new URL(url).origin, "https://v3-cinemeta.strem.io");
    assert(sources[id], "Only the covered show's metadata may be requested");
    requested.push(id);
    return new Response(JSON.stringify({ meta: sources[id] }));
  };
  const remote = bucket();
  const read = createLibraryReader(remote.fetcher);
  const saveVocabulary = async index => {
    const assets = new Map();
    addVocabulary(index, assets);
    for (const [assetPath, bytes] of assets) await writeFile(path.join(directory, path.basename(assetPath)), bytes);
  };
  await saveVocabulary(initialIndex);
  await writeFile(path.join(directory, "index.json"), JSON.stringify(initialIndex));
  await uploadPublication(await preparePublication(directory, sourceFetcher, options), remote);
  const initial = await read();
  assert.deepEqual(Object.keys(initial.catalogue.shows), [firstShow]);

  await saveVocabulary(nextIndex);
  await writeFile(path.join(directory, "index.json"), JSON.stringify(nextIndex));
  const prepared = await preparePublication(directory, sourceFetcher, options);
  assert.deepEqual(requested, [firstShow, newShow]);
  const offline = () => { throw new Error("Cinemeta unavailable"); };
  const cached = await preparePublication(directory, offline, options);
  assert.deepEqual(cached.bytes, prepared.bytes);
  await uploadPublication(prepared, remote);
  const updated = await read();
  assert.notEqual(updated.publication, initial.publication);
  assert.deepEqual(updated.index.tracks, nextIndex.tracks);
  assert.deepEqual(Object.keys(updated.catalogue.shows).sort(), [firstShow, newShow].sort());
  for (const id of [firstShow, newShow]) {
    const meta = showMetadata(updated.index, updated.catalogue, "series", `yomiru:${id}`);
    for (const [key, value] of Object.entries(sources[id])) {
      if (["id", "videos"].includes(key)) continue;
      assert.deepEqual(meta[key], value, `${id} detail ${key}`);
    }
    assert.deepEqual(meta.videos.map(v => v.id), nextIndex.tracks
      .flatMap(track => track.videoIds).filter(videoId => videoId.startsWith(`${id}:`)));
    for (const video of meta.videos) {
      const original = sources[id].videos.find(v => v.id === video.id);
      for (const [key, value] of Object.entries(original)) assert.deepEqual(video[key], value);
      assert.equal(video.title, original.name);
      assert.equal(Object.hasOwn(video, "streams"), false);
    }
  }

  const publishedPointer = remote.files.get(storage.pointer);
  const cacheFile = path.join(options.cinemetaCacheDir, "series", newShow + ".json");
  const verified = await readFile(cacheFile);
  const missingIndex = { ...nextIndex, tracks: [...nextIndex.tracks, track(4, `${newShow}:1:10`)] };
  await saveVocabulary(missingIndex);
  await writeFile(path.join(directory, "index.json"), JSON.stringify(missingIndex));
  await assert.rejects(() => preparePublication(directory, sourceFetcher, options),
    new RegExp(`Missing catalogue episode metadata: ${newShow}:1:10`));
  assert.deepEqual(await readFile(cacheFile), verified);
  await assert.rejects(() => preparePublication(directory, offline, options), /Cinemeta unavailable/);
  assert.equal(remote.files.get(storage.pointer), publishedPointer);

  sources[newShow].videos.push({ id: `${newShow}:1:10`, season: 1, episode: 10, title: "New episode" });
  const refreshed = await preparePublication(directory, sourceFetcher, options);
  assert.equal(refreshed.catalogue.shows[newShow].videos.find(v => v.episode === 10).title, "New episode");
  assert.deepEqual((await preparePublication(directory, offline, options)).bytes, refreshed.bytes);
  assert.deepEqual(requested, [firstShow, newShow, newShow, newShow]);

  const refreshedFile = await readFile(cacheFile);
  sources[newShow].videos = [];
  await assert.rejects(() => preparePublication(directory, sourceFetcher, { ...options, refreshCinemeta: true }),
    new RegExp(`Missing catalogue episode metadata: ${newShow}:1:8`));
  assert.deepEqual(await readFile(cacheFile), refreshedFile);
  assert.deepEqual((await readdir(path.dirname(cacheFile))).sort(), [firstShow + ".json", newShow + ".json"]);
  assert.equal(remote.files.get(storage.pointer), publishedPointer);
});

test("movie metadata is reused only from an intact Cinemeta entry for that identity", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "yomiru-movie-metadata-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { index, assets } = fixture([1], { type: "movie", vocabulary: [1] });
  const [id] = index.tracks[0].videoIds;
  await writeFile(path.join(directory, "index.json"), JSON.stringify(index));
  for (const [assetPath, bytes] of assets) await writeFile(path.join(directory, path.basename(assetPath)), bytes);
  const options = { cinemetaCacheDir: path.join(directory, "cache") };
  const url = `https://v3-cinemeta.strem.io/meta/movie/${id}.json`;
  const source = { id, type: "movie", name: "Original movie", description: "A synthetic story" };
  const fromCinemeta = async requested => {
    assert.equal(requested, url);
    return Response.json({ meta: source });
  };
  const prepared = await preparePublication(directory, fromCinemeta, options);
  assert.equal(prepared.catalogue.movies[id].name, source.name);
  const filename = path.join(options.cinemetaCacheDir, "movie", id + ".json");
  const entry = JSON.parse(await readFile(filename, "utf8"));
  assert.equal(entry.sourceUrl, url);
  assert(Number.isFinite(Date.parse(entry.fetchedAt)));
  assert.equal(entry.sha256, createHash("sha256").update(JSON.stringify(entry.metadata)).digest("hex"));
  const offline = () => { throw new Error("Cinemeta unavailable"); };
  assert.deepEqual((await preparePublication(directory, offline, options)).bytes, prepared.bytes);
  entry.metadata.name = "Edited movie";
  await writeFile(filename, JSON.stringify(entry));
  await assert.rejects(() => preparePublication(directory, offline, options), /Cinemeta unavailable/);
  const wrongMovie = async () => Response.json({ meta: { ...source, id: "tt2345678" } });
  await assert.rejects(() => preparePublication(directory, wrongMovie, options), /metadata identity/);
  assert.deepEqual((await preparePublication(directory, fromCinemeta, options)).bytes, prepared.bytes);
  source.name = "Refreshed movie";
  const refreshed = await preparePublication(directory, fromCinemeta, { ...options, refreshCinemeta: true });
  assert.equal(refreshed.catalogue.movies[id].name, source.name);
  assert.deepEqual((await preparePublication(directory, offline, options)).bytes, refreshed.bytes);
});

test("asset failure or a concurrent publisher never commits a partial snapshot", async () => {
  const data = fixture([1], { vocabulary: [1] });
  const next = fixture([1, 2], { vocabulary: [1, 2] });
  const remote = bucket();
  await assert.rejects(() => uploadPublication(data, {
    ...remote, put: async (pathname, ...args) => {
      if (pathname.endsWith(".vocabulary.json")) throw new Error("Vocabulary upload failed");
      return remote.put(pathname, ...args);
    },
  }), /Vocabulary upload failed/);
  assert(remote.files.has(data.index.tracks[0].path));
  assert.equal(remote.files.has(storage.pointer), false);
  const existing = bucket(data);
  await assert.rejects(() => uploadPublication(next, {
    ...existing, put: async pathname => {
      if (pathname === storage.pointer) throw new Error("ETag precondition failed");
      existing.files.set(pathname, next.bytes);
    },
  }));
  assert.deepEqual(JSON.parse(existing.files.get(storage.pointer)), data.pointer);
});

test("verification tolerates delayed public visibility but rejects corrupt or unavailable objects", async () => {
  const bytes = Buffer.from("immutable asset");
  let reads = 0;
  const waits = [];
  await verifyUploadedObject("https://example.org/asset", bytes, {
    fetcher: async () => ++reads < 3 ? new Response(null, { status: 404 }) : new Response(bytes),
    pause: async ms => waits.push(ms),
  });
  assert.equal(reads, 3);
  assert.deepEqual(waits, [1000, 2000]);
  reads = 0;
  await assert.rejects(() => verifyUploadedObject("https://example.org/asset", bytes, {
    fetcher: async () => { reads += 1; return new Response("corrupt"); },
    pause: async () => assert.fail("Corrupt data must not be retried"),
  }));
  assert.equal(reads, 1);
  reads = 0;
  await assert.rejects(() => verifyUploadedObject("https://example.org/asset", bytes, {
    fetcher: async () => { reads += 1; return new Response(null, { status: 404 }); }, pause: async () => {},
  }));
  assert.equal(reads, 7);
});
