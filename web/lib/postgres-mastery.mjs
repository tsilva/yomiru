import { moviePositions } from "./browse.mjs";

// The public serving tables already track playable words and title memberships.
// Resolve every requested scope against the same publication in one statement.
async function queryMastery(sql, { publication, titles, groups, selection }, packed) {
  const series = groups.filter(id => !id.startsWith("movie:"));
  const movies = groups.filter(id => id.startsWith("movie:")).map(id => id.slice(6));
  const members = packed ? sql`
      SELECT DISTINCT kind, scope, (entry.posting >> 32)::integer AS term_id
      FROM scoped_titles AS s JOIN yomiru_practice_title_posting AS title ON title.video_id = s.id
      CROSS JOIN LATERAL unnest(title.postings) AS entry(posting)
      WHERE (SELECT valid FROM head)` : sql`
      SELECT DISTINCT kind, scope, w.word_id
      FROM scoped_titles AS s JOIN yomiru_public_title_word AS w ON w.video_id = s.id
      WHERE (SELECT valid FROM head)`;
  const playable = packed ? sql`
      SELECT kind, scope, key.word_id FROM members JOIN yomiru_practice_word_key AS key USING (term_id)
      WHERE key.rank_weight IS NOT NULL` : sql`
      SELECT kind, scope, m.word_id FROM members AS m JOIN yomiru_public_practice_card AS card USING (word_id)`;
  const [result] = await sql`
      WITH head AS MATERIALIZED (
        SELECT revision, revision = ${publication} AS valid
        FROM yomiru_incremental_head WHERE singleton AND serving
      ), scoped_titles AS (
        SELECT 'title' AS kind, c.id AS scope, c.id
        FROM yomiru_incremental_catalogue AS c
        WHERE c.id = ANY(${titles}::text[]) AND c.detail ->> 'unlisted' IS DISTINCT FROM 'true'
        UNION ALL
        SELECT 'group', c.show_id, c.id FROM yomiru_incremental_catalogue AS c
        WHERE c.show_id = ANY(${series}::text[]) AND c.detail ->> 'type' IS DISTINCT FROM 'movie'
          AND c.detail ->> 'unlisted' IS DISTINCT FROM 'true'
        ${movies.length ? sql`
          UNION ALL
          SELECT 'group', 'movie:' || coalesce(known.name, 'Other Movies'), c.id
          FROM yomiru_incremental_metadata AS m JOIN yomiru_incremental_catalogue AS c USING (id)
          LEFT JOIN jsonb_to_recordset(${sql.json(moviePositions)}::jsonb) AS known(id text, name text) USING (id)
          WHERE m.type = 'movie' AND coalesce(known.name, 'Other Movies') = ANY(${movies}::text[])
            AND c.detail ->> 'unlisted' IS DISTINCT FROM 'true'
        ` : sql``}
        ${Array.isArray(selection) ? sql`
          UNION ALL
          SELECT 'selection', '', c.id FROM yomiru_incremental_catalogue AS c
          WHERE c.id = ANY(${selection}::text[]) AND c.detail ->> 'unlisted' IS DISTINCT FROM 'true'
        ` : sql``}
      ), members AS (${members}), playable AS (
        ${playable}
        ${selection === "all" ? sql`
          UNION ALL
          SELECT 'selection', '', word_id FROM yomiru_public_practice_card WHERE (SELECT valid FROM head)
        ` : sql``}
      ), results AS (
        SELECT kind, scope, jsonb_agg(word_id) AS words FROM playable GROUP BY kind, scope
      )
      SELECT revision, valid, coalesce((SELECT jsonb_agg(jsonb_build_array(kind, scope, words)) FROM results),
        '[]'::jsonb) AS scopes FROM head`;
  return result;
}

const unpackedUntil = new WeakMap();

export async function readPostgresMastery(sql, request) {
  const packed = Date.now() >= (unpackedUntil.get(sql) ?? 0);
  try {
    return await queryMastery(sql, request, packed);
  } catch (error) {
    if (packed && error.code === "42P01" && /yomiru_practice_(title_posting|word_key)/.test(error.message)) {
      unpackedUntil.set(sql, Date.now() + 30_000);
      return queryMastery(sql, request, false);
    }
    if (error.code === "42P01" && /yomiru_incremental_head/.test(error.message)) return undefined;
    throw error;
  }
}
