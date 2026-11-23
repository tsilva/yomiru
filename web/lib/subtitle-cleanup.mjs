import { createHash } from "node:crypto";

export const canonicalSubtitleKey = /^library\/[a-f0-9]{64}\.ass$/;
const revisionPattern = /^[a-f0-9]{64}$/;
const uploadGraceMs = 24 * 60 * 60 * 1000;
export const subtitleCleanupBatchSize = 8;

export function isSubtitleCleanupCandidate(item) {
  return typeof item?.key === "string" && canonicalSubtitleKey.test(item.key) && Number.isSafeInteger(item.bytes)
    && item.bytes >= 0 && typeof item.modified === "string" && Number.isFinite(Date.parse(item.modified));
}

async function readCleanupState(tx, previous, lock = false) {
  const [head] = await tx`SELECT catalogue_revision AS revision, revision AS journal, serving
    FROM yomiru_incremental_head WHERE singleton ${lock ? tx`FOR UPDATE` : tx``}`;
  if (!head?.serving || (previous !== undefined && previous !== head.revision)) {
    throw new Error("Incremental catalogue changed or is paused");
  }
  const active = await tx`SELECT detail ->> 'path' AS path, detail ->> 'playbackReady' = 'true' AS ready
    FROM yomiru_incremental_track
    WHERE detail -> 'superseded' IS DISTINCT FROM 'true'::jsonb`;
  if (active.some(({ path }) => typeof path !== "string" || !canonicalSubtitleKey.test(path.slice(1))
    || !path.startsWith("/"))) throw new Error("An active subtitle has an invalid storage path");
  const [{ now }] = await tx`SELECT clock_timestamp() AS now`;
  const uploads = await tx`SELECT key FROM yomiru_subtitle_upload WHERE expires_at > clock_timestamp()`;
  return { revision: head.revision, journal: head.journal, playbackReady: active.every(({ ready }) => ready),
    cutoff: now.getTime() - uploadGraceMs,
    active: new Set(active.map(({ path }) => path.slice(1))), staged: new Set(uploads.map(({ key }) => key)) };
}

export async function protectSubtitleUpload(sql, key) {
  if (!canonicalSubtitleKey.test(key)) throw new Error("Invalid staged subtitle key");
  const [{ installed }] = await sql`SELECT to_regclass('yomiru_subtitle_upload') IS NOT NULL
    AND to_regclass('yomiru_incremental_head') IS NOT NULL AS installed`;
  if (!installed) return;
  await sql.begin(async tx => {
    const [head] = await tx`SELECT serving FROM yomiru_incremental_head WHERE singleton FOR UPDATE`;
    if (!head?.serving) return;
    await tx`DELETE FROM yomiru_subtitle_upload WHERE expires_at <= clock_timestamp()`;
    await tx`INSERT INTO yomiru_subtitle_upload (key, expires_at)
      VALUES (${key}, clock_timestamp() + interval '24 hours')
      ON CONFLICT (key) DO UPDATE SET expires_at = excluded.expires_at`;
  });
}

function protectedReason({ key, modified }, { active, staged, cutoff }) {
  if (active.has(key)) return "active";
  if (staged.has(key)) return "staged";
  if (modified >= cutoff) return "recent";
  return null;
}

export async function planSubtitleCleanup(sql, objects, { previous, after } = {}) {
  const page = await objects.subtitlePage(after);
  const state = await sql.begin("isolation level repeatable read read only", tx => readCleanupState(tx, previous));
  const counts = { active: 0, staged: 0, recent: 0, candidates: 0 };
  const candidates = [];
  for (const object of page.objects) {
    const reason = protectedReason(object, state);
    counts[reason ?? "candidates"]++;
    if (reason === null) candidates.push({ ...object, modified: new Date(object.modified).toISOString() });
  }
  return { revision: state.revision, activeKeys: state.active.size, counts, candidates, next: page.next };
}

async function confirmCandidates(objects, candidates, state) {
  const current = await Promise.all(candidates.map(async item => {
    const asset = await objects.head(item.key, { modified: true });
    if (protectedReason({ key: item.key, modified: asset?.modified ?? 0 }, state)
      || (asset && (asset.size !== item.bytes
        || asset.modified !== Math.floor(Date.parse(item.modified) / 1000) * 1000))) {
      throw new Error("A reviewed subtitle changed or is now protected; run the dry run again");
    }
    return asset && item.key;
  }));
  return current.filter(Boolean);
}

const digest = input => createHash("sha256").update(JSON.stringify(input)).digest("hex");

export function subtitleCleanupPlanDigest({ revision, candidates }) {
  return digest([revision, [...candidates].sort((a, b) => a.key.localeCompare(b.key))
    .map(({ key, bytes, modified }) => [key, bytes, modified])]);
}

export async function applySubtitleCleanup(sql, objects, { previous, candidates }) {
  if (!revisionPattern.test(previous) || !Array.isArray(candidates) || !candidates.length
    || candidates.length > subtitleCleanupBatchSize || !candidates.every(isSubtitleCleanupCandidate)
    || new Set(candidates.map(({ key }) => key)).size !== candidates.length) {
    throw new Error("Supply up to eight reviewed subtitle objects and the catalogue revision");
  }
  // Commit the retirement receipt before touching storage. Older publishers
  // reject these keys even if they verified their upload before cleanup began.
  const requestKey = digest(["inventory-cleanup", candidates.map(({ key }) => key).sort()]);
  await sql.begin(async tx => {
    const state = await readCleanupState(tx, previous, true);
    if (!state.playbackReady) throw new Error("Complete legacy subtitle playback migration before cleanup");
    const keys = await confirmCandidates(objects, candidates, state);
    if (!keys.length) return;
    const revision = digest([state.journal, requestKey]);
    const inserted = await tx`INSERT INTO yomiru_incremental_change (revision, previous, request_key, payload)
      VALUES (${revision}, ${state.journal}, ${requestKey},
        ${tx.json({ kind: "purge-superseded-tracks", source: "inventory-cleanup", keys })})
      ON CONFLICT (request_key) DO NOTHING RETURNING revision`;
    if (inserted.length) await tx`UPDATE yomiru_incremental_head SET revision = ${revision} WHERE singleton`;
  });
  return sql.begin(async tx => {
    await tx`SET LOCAL idle_in_transaction_session_timeout = '45s'`;
    const state = await readCleanupState(tx, previous, true);
    const keys = await confirmCandidates(objects, candidates, state);
    // Hold the catalogue lock until every delete and verification settles.
    const results = await Promise.allSettled(keys.map(key => objects.deleteSubtitle(key)));
    if (results.some(result => result.status === "rejected")) throw new Error("Subtitle cleanup incomplete; retry the reviewed batch");
    await tx`DELETE FROM yomiru_subtitle_upload WHERE expires_at <= clock_timestamp()`;
    return { revision: state.revision, deleted: keys, absent: candidates.map(({ key }) => key)
      .filter(key => !keys.includes(key)) };
  });
}
