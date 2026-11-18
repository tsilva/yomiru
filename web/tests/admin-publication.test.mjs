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
  const data = fixture([1], { vocabulary: true });
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

test("both publication backends reject a movie snapshot with no vocabulary before activating it", async () => {
  const data = fixture([1], { type: "movie" });
  const missing = /Missing vocabulary for published video: tt1234561/;
  await assert.rejects(() => writePublicationObject({ path: data.pointer.path, content: data.bytes.toString("base64") }), missing);
  const payload = { path: storage.pointer, content: Buffer.from(JSON.stringify(data.pointer)).toString("base64") };
  await assert.rejects(() => writePublicationObject(payload, {
    head: async () => null,
    fetcher: async () => new Response(data.bytes),
    put: async () => assert.fail("The pointer must stay unchanged"),
  }), missing);
  await assert.rejects(() => activateR2Publication({}, data.pointer, {
    readObject: async pathname => {
      assert.equal(pathname, data.pointer.path);
      return { bytes: data.bytes };
    },
    publications: { current: async () => null, activate: async () => assert.fail("The database must stay unchanged") },
  }), missing);
});

test("R2 activation passes the movie subtitles and vocabulary to the same database transaction", async () => {
  const data = fixture([1], { type: "movie", vocabulary: true });
  const [id] = data.index.tracks[0].videoIds;
  const calls = [];
  await activateR2Publication({}, data.pointer, {
    readObject: async pathname => ({ bytes: pathname === data.pointer.path ? data.bytes : data.assets.get(pathname) }),
    publications: { current: async () => null, activate: async publication => calls.push(publication) },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].tracks, data.index.tracks);
  assert.deepEqual(calls[0].episodes.map(row => row.episode), [id]);
  assert.deepEqual(calls[0].catalogueRows.map(row => row.id), [id]);
});
