import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { preparePublication, uploadPublication, preserveCoverage, verifyUploadedObject, createAdminExecutor } from "../scripts/upload-library.mjs";
import { createLibraryReader, storage } from "../lib/published-library.mjs";
import { showMetadata } from "../lib/catalogue.mjs";
import { fixture } from "./library-fixture.mjs";

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
  const data = fixture();
  const remote = bucket();
  await uploadPublication(data, remote);
  assert.equal(remote.writes.at(-1), storage.pointer);
  assert.deepEqual(JSON.parse(remote.files.get(storage.pointer)), data.pointer);
  assert.equal((await uploadPublication(data, remote)).unchanged, true);
  assert.equal(remote.writes.filter(p => p === storage.pointer).length, 1);
});

test("new episode updates the pointer conditionally while preserving previous coverage", async () => {
  const first = fixture([1]), second = fixture([1, 2]);
  const remote = bucket(first);
  const result = await uploadPublication(second, remote);
  assert.equal(result.tracks, 2);
  assert.equal(remote.writes.at(-1), storage.pointer);
  assert.throws(() => preserveCoverage(second.index, first.index));
});

test("new shows and episodes automatically inherit source metadata through publication and a running reader", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "yomiru-metadata-publication-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
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
  await writeFile(path.join(directory, "index.json"), JSON.stringify(initialIndex));
  await uploadPublication(await preparePublication(directory, sourceFetcher), remote);
  const initial = await read();
  assert.deepEqual(Object.keys(initial.catalogue.shows), [firstShow]);

  await writeFile(path.join(directory, "index.json"), JSON.stringify(nextIndex));
  const prepared = await preparePublication(directory, sourceFetcher);
  assert.deepEqual(requested, [firstShow, firstShow, newShow]);
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
  sources[newShow].videos = [];
  await assert.rejects(() => preparePublication(directory, sourceFetcher),
    new RegExp(`Missing catalogue episode metadata: ${newShow}:1:8`));
  assert.equal(remote.files.get(storage.pointer), publishedPointer);
});

test("asset failure or a concurrent publisher never commits a partial snapshot", async () => {
  const data = fixture();
  const remote = bucket();
  await assert.rejects(() => uploadPublication(data, {
    ...remote, put: async () => { throw new Error("upload failed"); },
  }));
  assert.equal(remote.files.has(storage.pointer), false);
  const existing = bucket(data);
  await assert.rejects(() => uploadPublication(fixture([1, 2]), {
    ...existing, put: async pathname => {
      if (pathname === storage.pointer) throw new Error("ETag precondition failed");
      existing.files.set(pathname, fixture([1, 2]).bytes);
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
