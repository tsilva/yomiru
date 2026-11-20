import postgres from "postgres";
import { r2Origin } from "./storage-config.mjs";
import { episodeSearchText } from "./browse.mjs";
import { createIncrementalStore } from "./incremental-publication.mjs";

let client;
export function database() {
  r2Origin();
  if (client) return client;
  const url = process.env.DATABASE_URL;
  const host = new URL(url).hostname;
  const pooled = host.endsWith(".neon.tech") && host.split(".")[0].endsWith("-pooler");
  return client = postgres(url, {
    ssl: "verify-full",
    prepare: false,
    max: pooled ? 8 : 2,
    connect_timeout: 5,
    idle_timeout: 20,
    connection: { statement_timeout: 15000, idle_in_transaction_session_timeout: 15000 },
    onnotice: () => {},
  });
}

export async function activateLegacyPublication(tx, {
  revision, expected, snapshot, lexemes, episodes, catalogueRows, tracks,
}) {
  const [current] = await tx`SELECT revision FROM yomiru_active WHERE singleton FOR UPDATE`;
  if (!current || current.revision !== expected) throw new Error("Publication changed");
  if (current.revision === revision) return;
  const [inserted] = await tx`INSERT INTO yomiru_publication (revision, snapshot) VALUES (${revision}, ${snapshot})
    ON CONFLICT DO NOTHING RETURNING revision`;
  if (inserted) {
    const rows = catalogueRows.map((row, ordinal) => ({
      revision, id: row.id, ordinal, show_id: row.id.split(":")[0],
      search_text: episodeSearchText(row), detail: tx.json(row),
    }));
    for (let start = 0; start < rows.length; start += 1000) {
      await tx`INSERT INTO yomiru_episode ${tx(rows.slice(start, start + 1000))}`;
    }
    const trackRows = tracks.flatMap((track, ordinal) => [...new Set(track.videoIds)].map(video_id => ({
      revision, media_type: track.type, video_id, ordinal, detail: tx.json(track),
    })));
    for (let start = 0; start < trackRows.length; start += 1000) {
      await tx`INSERT INTO yomiru_episode_track ${tx(trackRows.slice(start, start + 1000))}`;
    }
    for (let start = 0; start < lexemes.length; start += 1000) {
      const rows = lexemes.slice(start, start + 1000).map(word => ({
        revision, id: word.id, detail: tx.json(word),
      }));
      await tx`INSERT INTO yomiru_lexeme ${tx(rows, "revision", "id", "detail")}`;
    }
    for (const { episode, header, words } of episodes) {
      await tx`INSERT INTO yomiru_episode_vocabulary VALUES (${revision}, ${episode}, ${tx.json(header)})`;
      for (let start = 0; start < words.length; start += 1000) {
        const rows = words.slice(start, start + 1000).map(({ detail, languages }) => ({
          revision, episode, id: detail.id, detail: tx.json(detail), languages: tx.array(languages, 25),
        }));
        await tx`INSERT INTO yomiru_episode_word ${tx(rows, "revision", "episode", "id", "detail", "languages")}`;
      }
    }
  }
  await tx`UPDATE yomiru_active SET revision = ${revision} WHERE singleton`;
}

export function createPublicationStore(sql) {
  return {
    async current() {
      const [row] = await sql`SELECT revision FROM yomiru_active WHERE singleton`;
      return row?.revision ?? null;
    },
    async snapshot(revision) {
      const [row] = await sql`SELECT snapshot FROM yomiru_publication WHERE revision = ${revision}`;
      if (!row) throw new Error("Publication is missing");
      return row.snapshot;
    },
    async activate(publication) {
      return sql.begin(tx => activateLegacyPublication(tx, publication));
    },
    async browse(revision, { show, terms, offset }, limit) {
      const rows = await sql`
        SELECT detail FROM yomiru_episode
        WHERE revision = ${revision} AND (${show} = '' OR show_id = ${show})
        AND NOT EXISTS (SELECT 1 FROM unnest(${sql.array(terms, 25)}::text[]) AS term(value)
          WHERE position(term.value IN search_text) = 0)
        ORDER BY ordinal LIMIT ${limit} OFFSET ${offset}
      `;
      return rows.map(row => row.detail);
    },
    async episodeRows(revision, ids) {
      const rows = await sql`SELECT id, detail FROM yomiru_episode WHERE revision = ${revision}
        AND id = ANY(${sql.array(ids, 25)})`;
      return new Map(rows.map(({ id, detail }) => [id, detail]));
    },
    async tracks(revision, type, id) {
      const rows = await sql`SELECT detail FROM yomiru_episode_track WHERE revision = ${revision}
        AND media_type = ${type} AND video_id = ${id} ORDER BY ordinal`;
      return rows.map(row => row.detail);
    },
    async selectionSummary(episodes) {
      const all = !episodes;
      const [result] = await sql`
        WITH active AS (
          SELECT revision FROM yomiru_active WHERE singleton AND revision IS NOT NULL
        ), validated AS (
          SELECT revision, ${all ? sql`true` : sql`NOT EXISTS (
            SELECT 1 FROM jsonb_to_recordset(${sql.json(episodes)}::jsonb)
              AS requested(id text, revision text, registry text)
            LEFT JOIN yomiru_episode AS episode ON episode.revision = active.revision AND episode.id = requested.id
            WHERE episode.detail #>> '{vocabulary,sha256}' IS DISTINCT FROM requested.revision
               OR episode.detail #>> '{vocabulary,registry}' IS DISTINCT FROM requested.registry
          )`} AS matches FROM active
        ), selected AS (
          SELECT word.id, bool_or('eng' = ANY(word.languages)) AS has_meaning
          FROM yomiru_episode_word AS word
          WHERE word.revision = (SELECT revision FROM validated WHERE matches)
          ${all ? sql`` : sql`AND word.episode = ANY(${sql.array(episodes.map(episode => episode.id), 25)})`}
          GROUP BY word.id
        )
        SELECT revision AS publication, matches, counts.total,
          jsonb_strip_nulls(jsonb_build_object('eng', NULLIF(counts.english, 0))) AS covered
          ${all ? sql`,
            (SELECT count(*)::int FROM yomiru_episode_vocabulary WHERE revision = validated.revision) AS "episodeCount",
            (SELECT count(*)::int FROM yomiru_episode_vocabulary WHERE revision = validated.revision
              AND episode ~ '^tt[0-9]+$') AS "movieCount"` : sql``}
        FROM validated CROSS JOIN (
          SELECT count(*)::int AS total, count(*) FILTER (WHERE has_meaning)::int AS english
          FROM selected
        ) AS counts
      `;
      if (!result) throw new Error("Published library is missing");
      const { matches, movieCount, ...summary } = result;
      return matches ? { ...summary, ...(movieCount ? { movieCount } : {}) } : null;
    },
    async documents(revision, episodes) {
      const rows = await sql`
        SELECT document.episode, document.header, COALESCE((
          SELECT jsonb_agg(COALESCE(word.detail, '{}'::jsonb) || occurrence.detail ORDER BY occurrence.id)
          FROM yomiru_episode_word AS occurrence
          LEFT JOIN yomiru_lexeme AS word ON (word.revision, word.id) = (occurrence.revision, occurrence.id)
          WHERE (occurrence.revision, occurrence.episode) = (document.revision, document.episode)
        ), '[]'::jsonb) AS words
        FROM yomiru_episode_vocabulary AS document
        WHERE revision = ${revision} AND episode = ANY(${sql.array(episodes, 25)})
      `;
      return new Map(rows.map(({ episode, header, words }) => [episode, { ...header, words }]));
    },
  };
}

export const publicationStore = () => createPublicationStore(database());

export async function servingPublicationStore(sql = database()) {
  const [{ installed }] = await sql`SELECT to_regclass('yomiru_incremental_head') IS NOT NULL AS installed`;
  if (installed) {
    const incremental = createIncrementalStore(sql);
    if ((await incremental.state())?.serving) return incremental;
  }
  return createPublicationStore(sql);
}
