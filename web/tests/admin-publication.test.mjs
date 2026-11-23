import assert from "node:assert/strict";
import test from "node:test";
import { protectedAdminHost, writePublicationObject } from "../lib/admin-publication.mjs";
import handler from "../api/admin-publish.mjs";
import { fixture } from "./library-fixture.mjs";
import { storage } from "../lib/published-library.mjs";
import { activateR2Publication } from "../lib/r2-publication.mjs";

test("admin writes reject the public domain and forwarded-host spoofing", () => {
  const env = { VERCEL_ENV: "production", VERCEL_URL: "protected.vercel.app", BLOB_STORE_ID: storage.storeId };
  assert.equal(Boolean(protectedAdminHost({ headers: { host: "yomiru.tsilva.eu",
    "x-forwarded-host": env.VERCEL_URL } }, env)), false);
  assert.equal(Boolean(protectedAdminHost({ headers: { host: env.VERCEL_URL } }, env)), true);
  assert.equal(Boolean(protectedAdminHost({ headers: { host: env.VERCEL_URL } },
    { ...env, VERCEL_ENV: "preview" })), false);
});

test("public admin URL returns 404 before touching storage", async () => {
  const result = { setHeader() {}, status(code) { this.code = code; return this; }, end() {} };
  await handler({ method: "POST", headers: { host: "yomiru.tsilva.eu" } }, result);
  assert.equal(result.code, 404);
  await handler({ method: "GET", query: { action: "plan-subtitle-cleanup" },
    headers: { host: "yomiru.tsilva.eu" } }, result);
  assert.equal(result.code, 404);
});

test("asset upload validates the content address and never overwrites an immutable file", async () => {
  const data = fixture();
  const track = data.index.tracks[0];
  let calls = 0;
  const clients = { head: async () => null, put: async (pathname, bytes, options) => {
    calls += 1;
    assert.equal(pathname, track.path.slice(1));
    assert.equal(bytes.equals(data.body), true);
    assert.equal(options.allowOverwrite, false);
  } };
  await writePublicationObject({ path: track.path, content: data.body.toString("base64") }, clients);
  assert.equal(calls, 1);
  await assert.rejects(() => writePublicationObject({ path: track.path,
    content: Buffer.from("tampered").toString("base64") }, clients));
  assert.equal(calls, 1);
});

test("commit rejects stale ETags and missing assets before changing the pointer", async () => {
  const data = fixture([1], { vocabulary: [1] });
  const payload = { path: storage.pointer, content: Buffer.from(JSON.stringify(data.pointer)).toString("base64") };
  let writes = 0;
  await assert.rejects(() => writePublicationObject({ ...payload, overwrite: true, etag: '"old"' }, {
    head: async () => ({ etag: '"new"' }), put: async () => { writes += 1; },
  }), /Publication changed/);
  await assert.rejects(() => writePublicationObject(payload, {
    head: async () => null, put: async () => { writes += 1; },
    fetcher: async () => new Response(data.bytes),
  }), /missing asset/);
  assert.equal(writes, 0);
});

test("R2 activates new subtitles and vocabulary together alongside an unchanged older track", async () => {
  const previous = fixture([1], { type: "movie" });
  const data = fixture([1, 2], { type: "movie", vocabulary: [2] });
  const ids = data.index.tracks.flatMap(track => track.videoIds);
  const calls = [];
  await activateR2Publication({ overwrite: true, etag: `"${previous.pointer.sha256}"` }, data.pointer, {
    readObject: async pathname => ({ bytes: pathname === data.pointer.path ? data.bytes : data.assets.get(pathname) }),
    publications: { current: async () => previous.pointer.sha256, snapshot: async () => previous.bytes,
      activate: async publication => calls.push(publication) },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].tracks, data.index.tracks);
  assert.deepEqual(calls[0].episodes.map(row => row.episode), [ids[1]]);
  assert.deepEqual(calls[0].catalogueRows.map(row => row.id), ids);
});
