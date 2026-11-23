import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { assContentType, decodeStoredAss, gzipAss } from "../lib/ass-storage.mjs";
import { writePublicationObject } from "../lib/admin-publication.mjs";
import { subtitles, validateAsset, validateIndex } from "../lib/library.mjs";
import { activateGzipTracks, gzipMigrationReceipt, pruneMigratedGzipTracks,
  stageGzipTracks } from "../lib/subtitle-gzip-migration.mjs";
import { planFingerprint, verifyGzipDelivery } from "../scripts/migrate-subtitles-gzip.mjs";
import { fixture } from "./library-fixture.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");

test("compressed ASS is content addressed, immutable and decoded before rendering", async () => {
  const { body, index } = fixture();
  const original = index.tracks[0];
  const { compressed, path, storage } = gzipAss(body);
  const track = { ...original, path, storage };
  assert.equal(storage.sha256, hash(compressed));
  assert.equal(track.sha256, hash(body));
  assert.notEqual(path, original.path);
  validateIndex({ ...index, tracks: [track] });
  assert.throws(() => validateIndex({ ...index, tracks: [{ ...track, path: original.path }] }), /Invalid published track/);
  validateAsset(track, decodeStoredAss(compressed));
  assert.equal(subtitles({ tracks: [track] }, track.type, track.videoIds[0])[0].id, track.id);
  let saved;
  const writer = {
    head: async () => saved && { size: compressed.length, encoding: "gzip", decodedSha256: track.sha256 },
    protectSubtitle: async key => assert.equal(key, path.slice(1)),
    put: async (key, data, opts) => {
      assert.equal(key, path.slice(1));
      assert.equal(opts.contentType, assContentType);
      assert.equal(opts.contentEncoding, "gzip");
      assert.equal(opts.decodedSha256, track.sha256);
      saved = data;
    },
    readObject: async () => ({ bytes: decodeStoredAss(saved) }),
    requireGzipSubtitles: true,
  };
  const upload = { path, content: compressed.toString("base64") };
  assert.equal((await writePublicationObject(upload, writer)).unchanged, false);
  assert.equal((await writePublicationObject(upload, writer)).unchanged, true);
  await assert.rejects(writePublicationObject({ path: original.path, content: body.toString("base64") }, writer),
    /require gzip/);
  const respond = async (key, encoding) => {
    assert.equal(key, path);
    return { status: 200, headers: { "content-type": assContentType, "access-control-allow-origin": "*",
      "content-encoding": encoding, "cf-cache-status": "HIT" },
    body: encoding === "gzip" ? compressed : body };
  };
  assert.equal(await verifyGzipDelivery(track, respond), "HIT");
  await assert.rejects(verifyGzipDelivery(track, key => respond(key, "gzip")), /identity/);
});

test("gzip cutover preserves track identity and cleans only recorded plain predecessors", {
  skip: !process.env.YOMIRU_TEST_PG_SOCKET,
}, async () => {
  const namespace = `subtitle_gzip_${process.pid}`;
  const options = { host: process.env.YOMIRU_TEST_PG_SOCKET, database: "postgres", max: 4, onnotice: () => {} };
  const manager = postgres(options);
  await manager`CREATE SCHEMA ${manager(namespace)}`;
  const sql = postgres({ ...options, connection: { search_path: namespace } });
  try {
    const connection = await sql.reserve();
    try {
      for (const name of ["schema.sql", "incremental.sql", "subtitle-uploads.sql"]) {
        await connection.file(fileURLToPath(new URL(`../db/${name}`, import.meta.url)));
      }
    } finally { connection.release(); }
    const before = "a".repeat(64);
    const { body, index } = fixture();
    const track = { ...index.tracks[0], playbackReady: true };
    const old = track.path.slice(1);
    const orphan = `library/${"b".repeat(64)}.ass`;
    const files = new Map([[old, { bytes: body, modified: Date.now() }], [orphan, { bytes: Buffer.from("orphan") }]]);
    const objects = {
      async read(key) { return files.has(key) ? { bytes: decodeStoredAss(files.get(key).bytes) } : null; },
      async head(key) {
        const object = files.get(key);
        return object ? { size: object.bytes.length, encoding: object.contentEncoding,
          decodedSha256: object.decodedSha256, modified: Math.floor(object.modified / 1000) * 1000 } : null;
      },
      async put(key, bytes, metadata) {
        if (!files.has(key)) files.set(key, { bytes, modified: Date.now(), ...metadata });
      },
      async deleteSubtitle(key) { files.delete(key); },
    };
    await sql`INSERT INTO yomiru_publication (revision, snapshot) VALUES (${before}, ${Buffer.from("{}")})`;
    await sql`INSERT INTO yomiru_incremental_head (baseline, revision, catalogue_revision, serving)
      VALUES (${before}, ${before}, ${before}, true)`;
    await sql`INSERT INTO yomiru_incremental_track (id, detail) VALUES (${track.id}, ${sql.json(track)})`;
    const staged = await stageGzipTracks(sql, objects, { previous: before, ids: [track.id] });
    assert.deepEqual(await stageGzipTracks(sql, objects, { previous: before, ids: [track.id] }), staged);
    assert.equal(files.size, 3);
    const failed = staged.entries.map(entry => ({ ...entry,
      next: { ...entry.next, storage: { ...entry.next.storage, bytes: entry.next.storage.bytes + 1 } } }));
    await assert.rejects(activateGzipTracks(sql, objects, { previous: before, entries: failed }), /missing/);
    const result = await activateGzipTracks(sql, objects, staged);
    const [{ detail }] = await sql`SELECT detail FROM yomiru_incremental_track WHERE id = ${track.id}`;
    assert.equal(detail.id, track.id);
    assert.equal(detail.sha256, track.sha256);
    assert.equal(detail.path, staged.entries[0].next.path);
    const receipt = await gzipMigrationReceipt(sql, { previous: result.revision });
    assert.deepEqual(receipt.entries, staged.entries);
    assert.equal(planFingerprint(receipt.entries), planFingerprint(staged.entries));
    assert.notEqual(planFingerprint(receipt.entries), planFingerprint(failed));
    await assert.rejects(sql`INSERT INTO yomiru_incremental_track (id, detail)
      VALUES ('plain', ${sql.json(track)})`, { constraint_name: "yomiru_active_ass_requires_gzip" });
    assert.deepEqual((await pruneMigratedGzipTracks(sql, objects, { previous: result.revision, offset: 0 })).deleted, [old]);
    assert.deepEqual((await pruneMigratedGzipTracks(sql, objects, { previous: result.revision, offset: 0 })).absent, [old]);
    assert.equal(files.has(orphan), true);
    assert.equal(files.has(detail.path.slice(1)), true);
  } finally {
    await sql.end();
    await manager`DROP SCHEMA ${manager(namespace)} CASCADE`;
    await manager.end();
  }
});
