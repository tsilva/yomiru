import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { incrementalAdmin } from "../lib/admin-incremental.mjs";
import { createIncrementalStore } from "../lib/incremental-publication.mjs";
import { createR2Store } from "../lib/r2.mjs";
import { protectSubtitleUpload } from "../lib/subtitle-cleanup.mjs";
import { readCleanupPlan } from "../scripts/cleanup-subtitles.mjs";

const keyFor = label => `library/${createHash("sha256").update(label).digest("hex")}.ass`;
const oldDate = "2026-01-01T00:00:00.123Z";

test("the signed R2 inventory scans past non-ASS keys and validates subtitle metadata", async () => {
  const first = keyFor("one");
  const second = keyFor("two");
  const cursor = "library/snapshots/summary.xml";
  const entry = (key, date = oldDate) => `<Contents><Key>${encodeURIComponent(key)}</Key>
    <Size>12</Size><LastModified>${date}</LastModified></Contents>`;
  const listing = (entries, truncated) => new Response(`<ListBucketResult><KeyCount>${entries.length}</KeyCount>
    <IsTruncated>${truncated}</IsTruncated>${entries.join("")}</ListBucketResult>`);
  let invalidDate = false;
  const bucket = createR2Store({
    PUBLIC_R2_ORIGIN: "https://assets.example.test", DATABASE_URL: "postgres://example.test",
    R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`, R2_BUCKET_NAME: "tracks",
    R2_ACCESS_KEY_ID: "fake-id", R2_SECRET_ACCESS_KEY: "fake-secret",
  }, { fetcher: async request => {
    const url = new URL(request.url);
    assert.equal(url.pathname, "/tracks");
    assert.equal(request.method, "GET");
    assert.match(request.headers.get("Authorization"), /Credential=fake-id/);
    assert.equal(url.searchParams.get("prefix"), "library/");
    assert.equal(url.searchParams.get("list-type"), "2");
    assert.equal(url.searchParams.get("encoding-type"), "url");
    const after = url.searchParams.get("start-after");
    if (after === null) return listing([entry(first), entry(cursor)], true);
    assert.equal(after, cursor);
    return listing([entry(second, invalidDate ? "unknown" : oldDate)], false);
  } });
  assert.deepEqual(await bucket.subtitlePage(), {
    objects: [{ key: first, bytes: 12, modified: Date.parse(oldDate) }], next: cursor,
  });
  assert.deepEqual(await bucket.subtitlePage(cursor), {
    objects: [{ key: second, bytes: 12, modified: Date.parse(oldDate) }], next: null,
  });
  invalidDate = true;
  await assert.rejects(bucket.subtitlePage(cursor), /Invalid R2 subtitle metadata/);
});

test("cleanup plans from active tracks, keeps staged writes, and retries exact deletions", {
  skip: !process.env.YOMIRU_TEST_PG_SOCKET,
}, async () => {
  const namespace = `subtitle_cleanup_${process.pid}`;
  const options = { host: process.env.YOMIRU_TEST_PG_SOCKET, database: "postgres", max: 3, onnotice: () => {} };
  const manager = postgres(options);
  await manager`CREATE SCHEMA ${manager(namespace)}`;
  const sql = postgres({ ...options, connection: { search_path: namespace } });
  try {
    const connection = await sql.reserve();
    try {
      for (const name of ["schema.sql", "incremental.sql", "subtitle-uploads.sql"]) {
        await connection.file(fileURLToPath(new URL(`../db/${name}`, import.meta.url)));
      }
    } finally {
      connection.release();
    }
    const revision = "a".repeat(64);
    await sql`INSERT INTO yomiru_publication (revision, snapshot) VALUES (${revision}, ${Buffer.from("{}")})`;
    await sql`INSERT INTO yomiru_incremental_head (baseline, revision, catalogue_revision, serving)
      VALUES (${revision}, ${revision}, ${revision}, true)`;
    const active = keyFor("active"), superseded = keyFor("superseded"), abandoned = keyFor("abandoned");
    const recent = keyFor("recent"), reused = keyFor("reused");
    const old = Date.parse(oldDate);
    const files = new Map([active, superseded, abandoned, recent, reused]
      .map(key => [key, { key, bytes: 12, modified: key === recent ? Date.now() : old }]));
    await sql`INSERT INTO yomiru_incremental_track (id, detail) VALUES
      ('current', ${sql.json({ path: `/${active}`, playbackReady: true })}),
      ('shared', ${sql.json({ path: `/${active}`, superseded: true })}),
      ('old', ${sql.json({ path: `/${superseded}`, superseded: true })})`;
    await protectSubtitleUpload(sql, reused);

    const deleting = Promise.withResolvers();
    const proceed = Promise.withResolvers();
    let failAbandonedDelete = true;
    const publicAssets = {
      async subtitlePage(after) {
        const keys = after ? [recent, reused] : [active, superseded, abandoned];
        return { objects: keys.flatMap(key => files.has(key) ? [files.get(key)] : []),
          next: after ? null : abandoned };
      },
      async head(key) {
        const object = files.get(key);
        return object ? { size: object.bytes, modified: Math.floor(object.modified / 1000) * 1000 } : null;
      },
      async deleteSubtitle(key) {
        if (key === abandoned) {
          deleting.resolve();
          await proceed.promise;
          if (failAbandonedDelete) throw new Error("Temporary R2 failure");
        }
        files.delete(key);
      },
    };
    const admin = input => incrementalAdmin(input.incremental, { sql, publicAssets });
    const plan = await readCleanupPlan(admin);
    assert.deepEqual(plan.counts, { active: 1, staged: 1, recent: 1, candidates: 2 });
    assert.equal(plan.bytes, 24);
    assert.deepEqual(plan.candidates.map(({ key }) => key), [superseded, abandoned]);
    assert.equal(files.size, 5);
    const apply = (candidates, previous = plan.revision) =>
      admin({ incremental: { action: "apply-subtitle-cleanup", previous, candidates } });
    await assert.rejects(apply(plan.candidates, "b".repeat(64)), /catalogue changed/);
    await assert.rejects(apply([{ ...plan.candidates[0], key: active }]), /now protected/);
    await assert.rejects(apply([{ ...plan.candidates[0], key: reused }]), /now protected/);
    await assert.rejects(apply([{ ...plan.candidates[0], bytes: 13 }]), /reviewed subtitle changed/);
    await protectSubtitleUpload(sql, superseded);
    await assert.rejects(apply(plan.candidates), /now protected/);
    assert.equal(files.size, 5);
    await sql`UPDATE yomiru_subtitle_upload SET expires_at = now() - interval '1 second' WHERE key = ${superseded}`;
    const purge = apply(plan.candidates);
    await Promise.race([deleting.promise, purge]);
    try {
      await assert.rejects(sql`SELECT 1 FROM yomiru_incremental_head WHERE singleton FOR UPDATE NOWAIT`,
        { code: "55P03" });
    } finally {
      proceed.resolve();
    }
    await assert.rejects(purge, /cleanup incomplete/);
    const [receipt] = await sql`SELECT payload FROM yomiru_incremental_change`;
    assert.deepEqual(receipt.payload, {
      kind: "purge-superseded-tracks", source: "inventory-cleanup", keys: [superseded, abandoned],
    });
    await assert.rejects(createIncrementalStore(sql).publishEpisode({
      revision, source: { manifest: { sha256: revision } }, tracks: [{ path: `/${abandoned}` }],
    }, revision), /removed subtitle file cannot be republished/);
    failAbandonedDelete = false;
    assert.deepEqual(await apply(plan.candidates), { revision, deleted: [abandoned], absent: [superseded] });
    assert.deepEqual(await apply(plan.candidates), { revision, deleted: [], absent: [superseded, abandoned] });
    assert.deepEqual([...files.keys()], [active, recent, reused]);
  } finally {
    await sql.end();
    await manager`DROP SCHEMA ${manager(namespace)} CASCADE`;
    await manager.end();
  }
});
