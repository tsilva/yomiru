import postgres from "postgres";
import { r2Origin } from "./storage-config.mjs";
import { episodeSearchText } from "./browse.mjs";

let client;
export function database() {
  r2Origin();
  return client ??= postgres(process.env.YOMIRU_DATABASE_URL, {
    ssl: "verify-full",
    prepare: false,
    max: 2,
    connect_timeout: 5,
    idle_timeout: 20,
    connection: { statement_timeout: 15000, idle_in_transaction_session_timeout: 15000 },
    onnotice: () => {},
  });
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
    async activate({ revision, expected, snapshot, lexemes, episodes, catalogueRows, tracks }) {
      return sql.begin(async tx => {
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
      });
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
    async summary(revision, episodes) {
      const rows = await sql`
        WITH selected AS (
          SELECT id, languages FROM yomiru_episode_word
          WHERE revision = ${revision} AND episode = ANY(${sql.array(episodes, 25)})
        )
        SELECT null AS language, count(DISTINCT id)::int AS count FROM selected
        UNION ALL
        SELECT language, count(DISTINCT id)::int FROM selected
          CROSS JOIN LATERAL unnest(languages) AS lang(language) GROUP BY language
      `;
      const covered = Object.fromEntries(rows.filter(row => row.language).map(row => [row.language, row.count]));
      return { total: rows.find(row => row.language === null).count, covered };
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
