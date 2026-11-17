import assert from "node:assert/strict";
import test from "node:test";
import { uploadPublication, preserveCoverage, verifyUploadedObject } from "../scripts/upload-library.mjs";
import { storage } from "../lib/published-library.mjs";
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
