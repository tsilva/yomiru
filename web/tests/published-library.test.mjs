import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fixture } from "./library-fixture.mjs";
import test from "node:test";
import {
  createLibraryReader, decodePublication, validatePointer, assetUrl, storage,
} from "../lib/published-library.mjs";


test("one running reader discovers a newly published episode without a redeploy", async () => {
  const first = fixture([1]), second = fixture([1, 2]);
  let current = first;
  let snapshotReads = 0;
  const read = createLibraryReader(async url => {
    if (url.endsWith(storage.pointer)) return new Response(JSON.stringify(current.pointer));
    snapshotReads += 1;
    assert.equal(url, storage.origin + current.pointer.path);
    return new Response(current.bytes);
  });
  assert.equal((await read()).index.tracks.length, 1);
  assert.equal((await read()).index.tracks.length, 1);
  assert.equal(snapshotReads, 1);
  current = second;
  assert.equal((await read()).index.tracks.length, 2);
  assert.equal(snapshotReads, 2);
});

test("broken or foreign pointers, corrupt snapshots and mismatched metadata fail closed", async () => {
  const data = fixture();
  assert.throws(() => validatePointer({ ...data.pointer, path: "https://example.test/data" }));
  assert.throws(() => decodePublication(Buffer.from("changed"), data.pointer.sha256));
  const mismatch = Buffer.from(JSON.stringify({ version: 1, index: data.index,
    catalogue: { ...data.catalogue, libraryRevision: "wrong" } }));
  assert.throws(() => decodePublication(mismatch, createHash("sha256").update(mismatch).digest("hex")));
  const read = createLibraryReader(async () => new Response("unavailable", { status: 503 }));
  await assert.rejects(read);
  assert.throws(() => assetUrl("/library/../../private"));
});

test("a cached snapshot never masks an unavailable or invalid current pointer", async () => {
  const data = fixture();
  let fail = false;
  const read = createLibraryReader(async url => {
    if (fail) return new Response("unavailable", { status: 503 });
    return new Response(url.endsWith(storage.pointer) ? JSON.stringify(data.pointer) : data.bytes);
  });
  await read();
  fail = true;
  await assert.rejects(read);
});
