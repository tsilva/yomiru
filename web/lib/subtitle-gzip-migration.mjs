import { createHash } from "node:crypto";
import { assContentType, assReadLimit, gzipAss, matchesAssHead, validAssPath } from "./ass-storage.mjs";
import { validateAsset } from "./library.mjs";
import { mapBatches } from "./r2-publication.mjs";
import { applySubtitleCleanup, isSubtitleCleanupCandidate, protectSubtitleUpload,
  subtitleCleanupBatchSize } from "./subtitle-cleanup.mjs";

const hash = /^[a-f0-9]{64}$/;
const kind = "gzip-subtitle-storage";
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const gzipStageBatchSize = 8;

async function requireCatalogue(db, previous, lock = false) {
  if (typeof previous !== "string" || !hash.test(previous)) throw new Error("Supply a catalogue revision");
  const [head] = await db`SELECT revision, catalogue_revision, serving
    FROM yomiru_incremental_head WHERE singleton ${lock ? db`FOR UPDATE` : db``}`;
  if (!head?.serving || head.catalogue_revision !== previous) throw new Error("Catalogue changed");
  return head;
}

async function loadPlainTracks(db, ids) {
  const rows = await db`SELECT detail FROM yomiru_incremental_track
    WHERE detail -> 'superseded' IS DISTINCT FROM 'true'::jsonb AND NOT detail ? 'storage'
      ${ids ? db`AND id = ANY(${db.array(ids, 25)})` : db``}
    ORDER BY id`;
  return rows.map(({ detail }) => detail);
}

export async function stageGzipTracks(sql, objects, { previous, ids }) {
  if (!Array.isArray(ids) || !ids.length || ids.length > gzipStageBatchSize
    || ids.some(id => typeof id !== "string" || !hash.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("Supply up to eight active track IDs");
  }
  const tracks = await sql.begin("isolation level repeatable read read only", async tx => {
    await requireCatalogue(tx, previous);
    return loadPlainTracks(tx, ids);
  });
  if (tracks.length !== ids.length || tracks.some(track => !track.playbackReady || !validAssPath(track))) {
    throw new Error("Only active plain playback-ready tracks can be staged");
  }
  const entries = await mapBatches(tracks, async track => {
    const oldKey = track.path.slice(1);
    const asset = await objects.read(oldKey, track.bytes);
    validateAsset(track, asset?.bytes ?? Buffer.alloc(0));
    const meta = await objects.head(oldKey, { modified: true, encoding: true });
    if (!matchesAssHead(track, meta)) throw new Error("Plain subtitle metadata changed");
    const { path, storage, compressed } = gzipAss(asset.bytes);
    const newKey = path.slice(1);
    await protectSubtitleUpload(sql, newKey);
    await objects.put(newKey, compressed, { contentType: assContentType, contentEncoding: "gzip",
      decodedSha256: track.sha256 });
    const next = { path, storage, sha256: track.sha256, bytes: track.bytes };
    const stored = await objects.head(newKey, { encoding: true });
    if (!matchesAssHead(next, stored) || stored.decodedSha256 !== next.sha256) {
      throw new Error("Gzip subtitle metadata did not match");
    }
    const verified = await objects.read(newKey, assReadLimit(next));
    validateAsset(next, verified?.bytes ?? Buffer.alloc(0));
    return { id: track.id, old: { key: oldKey, bytes: track.bytes, modified: new Date(meta.modified).toISOString() }, next };
  }, 4);
  return { previous, entries };
}

export async function activateGzipTracks(sql, objects, { previous, entries }) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 1000
    || entries.some(entry => typeof entry?.id !== "string" || !hash.test(entry.id)
      || !isSubtitleCleanupCandidate(entry.old) || !entry.next?.storage || !validAssPath(entry.next)
      || entry.old.key !== `library/${entry.next.sha256}.ass` || entry.next.bytes !== entry.old.bytes)
    || new Set(entries.map(({ id }) => id)).size !== entries.length) {
    throw new Error("A complete verified gzip migration is required");
  }
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const replacements = new Map(entries.map(({ next }) => [next.path, next]));
  if (entries.some(({ next }) => {
    const other = replacements.get(next.path);
    return other.sha256 !== next.sha256 || other.storage.bytes !== next.storage.bytes;
  })) throw new Error("Gzip aliases disagree about the stored subtitle");
  await mapBatches([...replacements.values()], async next => {
    const meta = await objects.head(next.path.slice(1), { encoding: true });
    if (!matchesAssHead(next, meta) || meta.decodedSha256 !== next.sha256) {
      throw new Error("A staged gzip subtitle is missing");
    }
  }, 8);

  return sql.begin(async tx => {
    const head = await requireCatalogue(tx, previous, true);
    const plain = await loadPlainTracks(tx);
    if (plain.length !== entries.length || plain.some(track => {
      const change = byId.get(track.id);
      return !change || !track.playbackReady || !validAssPath(track) || change.old.key !== track.path.slice(1)
        || change.next.sha256 !== track.sha256 || change.next.bytes !== track.bytes;
    })) throw new Error("Plain active tracks differ from the migration");
    const staged = await tx`SELECT key FROM yomiru_subtitle_upload WHERE expires_at > clock_timestamp()
      AND key = ANY(${tx.array([...replacements.keys()].map(path => path.slice(1)), 25)})`;
    if (staged.length !== replacements.size) throw new Error("Gzip upload reservations expired");

    const nextRows = plain.map(track => {
      const { path, storage } = byId.get(track.id).next;
      return { id: track.id, detail: { ...track, path, storage } };
    });
    await tx`UPDATE yomiru_incremental_track AS track SET detail = migrated.detail
      FROM jsonb_to_recordset(${tx.json(nextRows)}::jsonb) AS migrated(id text, detail jsonb)
      WHERE track.id = migrated.id`;
    await tx`ALTER TABLE yomiru_incremental_track ADD CONSTRAINT yomiru_active_ass_requires_gzip
      CHECK (detail -> 'superseded' IS NOT DISTINCT FROM 'true'::jsonb OR
        (detail #>> '{storage,encoding}' = 'gzip'
          AND detail #>> '{storage,sha256}' ~ '^[a-f0-9]{64}$'
          AND detail ->> 'path' = '/library/' || (detail #>> '{storage,sha256}') || '.ass') IS TRUE)`;
    const revision = digest([head.revision, kind, nextRows]);
    await tx`INSERT INTO yomiru_incremental_change (revision, previous, payload)
      VALUES (${revision}, ${head.revision}, ${tx.json({ kind, entries })})`;
    await tx`UPDATE yomiru_incremental_head SET revision = ${revision}, catalogue_revision = ${revision}
      WHERE singleton`;
    return { revision, migrated: entries.length };
  });
}

export async function gzipMigrationReceipt(sql, { previous }) {
  return sql.begin("isolation level repeatable read read only", async tx => {
    await requireCatalogue(tx, previous);
    const [row] = await tx`SELECT payload FROM yomiru_incremental_change
      WHERE revision = ${previous} AND payload ->> 'kind' = ${kind}`;
    if (!Array.isArray(row?.payload.entries)) throw new Error("The gzip migration is not the current catalogue");
    return { revision: previous, entries: row.payload.entries };
  });
}

export async function pruneMigratedGzipTracks(sql, objects, { previous, offset }) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % subtitleCleanupBatchSize !== 0) {
    throw new Error("Invalid migrated cleanup batch");
  }
  const { entries } = await gzipMigrationReceipt(sql, { previous });
  const oldObjects = [...new Map(entries.map(({ old }) => [old.key, old])).values()];
  const candidates = oldObjects.slice(offset, offset + subtitleCleanupBatchSize);
  if (!candidates.length) throw new Error("The cleanup batch is empty");
  return applySubtitleCleanup(sql, objects, { previous, candidates }, { migrated: true });
}
