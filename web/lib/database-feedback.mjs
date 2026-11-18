import { createHash } from "node:crypto";
import { digestPattern } from "./compatibility.mjs";

const voteKey = (group, release, voter) => createHash("sha256")
  .update(JSON.stringify([group, release, voter])).digest("hex");

async function readGroup(sql, id, voter) {
  const rows = await sql`
    SELECT release.id, release.detail, tally.total, tally.works
    FROM yomiru_release AS release
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS total, count(*) FILTER (WHERE works)::int AS works
      FROM yomiru_vote WHERE (group_id, release_id) = (release.group_id, release.id)
    ) AS tally
    WHERE release.group_id = ${id}
  `;
  const myVotes = new Map();
  if (voter && rows.length) {
    const ids = rows.map(row => row.id);
    const keys = ids.map(release => voteKey(id, release, voter));
    const matches = await sql`
      SELECT release_id, works FROM yomiru_vote WHERE group_id = ${id}
      AND (release_id, voter) IN (SELECT * FROM unnest(${sql.array(ids, 25)}::text[], ${sql.array(keys, 25)}::text[]))
    `;
    for (const match of matches) myVotes.set(match.release_id, match.works);
  }
  return { version: 1, groupId: id, releases: Object.fromEntries(rows.map(({ id: release, detail, works, total }) =>
    [release, { ...detail, myVote: myVotes.get(release) ?? null, summary: { works, total, doesntWork: total - works,
      percentWorks: total ? Math.round(100 * works / total) : null } }])) };
}

async function lockGroup(sql, id) {
  await sql`INSERT INTO yomiru_compatibility_group VALUES (${id}) ON CONFLICT DO NOTHING`;
  await sql`SELECT id FROM yomiru_compatibility_group WHERE id = ${id} FOR UPDATE`;
}

export function createDatabaseCompatibility(sql, now = () => new Date().toISOString()) {
  return {
    get: (group, voter) => voter
      ? sql.begin("isolation level repeatable read read only", tx => readGroup(tx, group.id, voter))
      : readGroup(sql, group.id),
    async observe(group, release, signal) {
      if (!release) return readGroup(sql, group.id);
      return sql.begin(async tx => {
        signal?.throwIfAborted();
        await lockGroup(tx, group.id);
        const [current] = await tx`SELECT detail FROM yomiru_release
          WHERE group_id = ${group.id} AND id = ${release.id}`;
        const timestamp = now();
        const detail = current ? { ...current.detail, filenames: [...current.detail.filenames] }
          : { ...release, filenames: [], firstSeen: timestamp };
        if (!current) {
          const [{ count }] = await tx`SELECT count(*)::int AS count FROM yomiru_release WHERE group_id = ${group.id}`;
          if (count >= 500) throw new Error("Source capacity reached");
        }
        if (release.filename && !detail.filenames.includes(release.filename) && detail.filenames.length < 8) {
          detail.filenames.push(release.filename);
          detail.filename ||= release.filename;
        }
        if (!current || detail.lastSeen?.slice(0, 10) !== timestamp.slice(0, 10)
          || detail.filenames.length !== current.detail.filenames.length) {
          detail.lastSeen = timestamp;
          signal?.throwIfAborted();
          await tx`INSERT INTO yomiru_release (group_id, id, detail)
            VALUES (${group.id}, ${release.id}, ${tx.json(detail)})
            ON CONFLICT (group_id, id) DO UPDATE SET detail = EXCLUDED.detail`;
        }
        return readGroup(tx, group.id);
      });
    },
    async vote(group, releaseId, voter, works) {
      if (!digestPattern.test(releaseId) || !digestPattern.test(voter) || typeof works !== "boolean") {
        throw new Error("Invalid vote");
      }
      const key = voteKey(group.id, releaseId, voter);
      return sql.begin(async tx => {
        const [release] = await tx`SELECT id FROM yomiru_release
          WHERE group_id = ${group.id} AND id = ${releaseId} FOR UPDATE`;
        if (!release) throw new Error("Source not observed for this subtitle revision");
        const [existing] = await tx`SELECT works FROM yomiru_vote
          WHERE group_id = ${group.id} AND release_id = ${releaseId} AND voter = ${key}`;
        if (existing?.works === works) return readGroup(tx, group.id, voter);
        if (!existing) {
          const [{ count }] = await tx`SELECT count(*)::int AS count FROM yomiru_vote
            WHERE group_id = ${group.id} AND release_id = ${releaseId}`;
          if (count >= 5000) throw new Error("Vote capacity reached");
        }
        await tx`INSERT INTO yomiru_vote VALUES (${group.id}, ${releaseId}, ${key}, ${works})
          ON CONFLICT (group_id, release_id, voter) DO UPDATE SET works = EXCLUDED.works`;
        return readGroup(tx, group.id, voter);
      });
    },
  };
}

export const databaseFeedbackIO = database => ({
  async read(path) {
    const code = path.split("/").at(-1).split(".")[0];
    const [row] = await database()`SELECT detail FROM yomiru_feedback_link WHERE code = ${code}`;
    return row ? { state: row.detail } : null;
  },
  async write(path, state) {
    const sql = database();
    const inserted = await sql`INSERT INTO yomiru_feedback_link VALUES (${state.code}, ${sql.json(state)})
      ON CONFLICT DO NOTHING RETURNING code`;
    return inserted.length === 1;
  },
});

export async function importCompatibilityGroup(sql, id, state) {
  if (state?.version !== 1 || state.groupId !== id || !digestPattern.test(id)
    || !state.releases || typeof state.releases !== "object" || Array.isArray(state.releases)) {
    throw new Error("Invalid compatibility export");
  }
  await sql.begin(async tx => {
    await lockGroup(tx, id);
    for (const [releaseId, release] of Object.entries(state.releases)) {
      const { votes, ...detail } = release;
      if (!digestPattern.test(releaseId) || releaseId !== detail.id || !Array.isArray(detail.filenames)
        || !votes || typeof votes !== "object" || Array.isArray(votes)) throw new Error("Invalid release export");
      await tx`INSERT INTO yomiru_release VALUES (${id}, ${releaseId}, ${tx.json(detail)})
        ON CONFLICT (group_id, id) DO UPDATE SET detail = EXCLUDED.detail`;
      const rows = Object.entries(votes).map(([voter, works]) => {
        if (!digestPattern.test(voter) || typeof works !== "boolean") throw new Error("Invalid vote export");
        return { group_id: id, release_id: releaseId, voter, works };
      });
      if (rows.length) await tx`INSERT INTO yomiru_vote ${tx(rows, "group_id", "release_id", "voter", "works")}
        ON CONFLICT (group_id, release_id, voter) DO UPDATE SET works = EXCLUDED.works`;
    }
  });
}
