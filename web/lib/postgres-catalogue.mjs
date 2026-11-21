import { BrowseError, browsePage, browseSelection, moviePositions, pageSize } from "./browse.mjs";
import { readReviewedPracticeTitles } from "./archived-practice.mjs";
import { reportServerError } from "./sentry-server.mjs";

let summaryRetryAt = 0;

async function queryCatalogue(sql, selection, summary) {
  const { show, terms, offset, after, expectedPublication } = selection;
  const [result] = await sql`
    WITH head AS MATERIALIZED (
      SELECT baseline, revision FROM yomiru_incremental_head WHERE singleton AND serving
    ), visible_movies AS (
      SELECT c.id, c.detail, known.name, known.number, known."group", known.title, known."theatricalTitle",
        CASE WHEN known.id IS NULL THEN count(*) FILTER (WHERE known.id IS NULL) OVER (
          ORDER BY CASE WHEN c.detail ->> 'year' ~ '^[0-9]{4}$' THEN (c.detail ->> 'year')::int END,
            (c.detail ->> 'title') COLLATE "en-x-icu", c.id
        ) END AS other_number
      FROM yomiru_incremental_metadata AS m JOIN yomiru_incremental_catalogue AS c USING (id)
      LEFT JOIN jsonb_to_recordset(${sql.json(moviePositions)}::jsonb)
        AS known(id text, name text, "group" integer, number integer, title text, "theatricalTitle" text) USING (id)
      WHERE m.type = 'movie' AND c.detail ->> 'unlisted' IS DISTINCT FROM 'true'
        AND (${!show || show.startsWith("movie:")}
          OR EXISTS (SELECT 1 FROM yomiru_incremental_metadata WHERE type = 'movie' AND id = ${show}))
    ), movies AS (
      SELECT id, "theatricalTitle", detail || jsonb_build_object(
        'title', coalesce(title, detail ->> 'title'), 'show', coalesce(name, 'Other Movies'), 'code',
        'M' || CASE WHEN coalesce(number, other_number) < 10 THEN '0' ELSE '' END || coalesce(number, other_number))
        AS detail,
        row_number() OVER (ORDER BY "group" NULLS LAST, coalesce(number, other_number), id) AS ordinal
      FROM visible_movies
    ), candidates AS (
      (SELECT 0 AS section, c.ordinal, c.detail FROM yomiru_incremental_catalogue AS c
        WHERE c.detail ->> 'type' IS DISTINCT FROM 'movie'
          AND (${show} = '' OR c.show_id = ${show} OR c.id = ${show})
          ${after ? sql`AND (0, c.ordinal) > (${after[0]}::integer, ${after[1]}::bigint)` : sql``}
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(${sql.json(terms)}::jsonb) AS token(value)
            WHERE position(token.value IN c.search_text) = 0)
        ORDER BY c.ordinal LIMIT ${after ? pageSize + 1 : offset + pageSize + 1})
      UNION ALL
      SELECT 1, m.ordinal, m.detail FROM movies AS m
      WHERE (${show} = '' OR ${show} = 'movie:' || (m.detail ->> 'show') OR ${show} = m.id)
        ${after ? sql`AND (1, m.ordinal) > (${after[0]}::integer, ${after[1]}::bigint)` : sql``}
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(${sql.json(terms)}::jsonb) AS token(value)
          WHERE position(token.value IN lower(normalize(concat_ws(' ', m.detail ->> 'show',
            m.detail ->> 'title', m."theatricalTitle", m.id, 'movies', m.detail ->> 'year', m.detail ->> 'code',
            (SELECT string_agg(concat_ws(' ', item ->> 'code', item ->> 'label'), ' ')
              FROM jsonb_array_elements(coalesce(m.detail -> 'translations', '[]'::jsonb)
                || coalesce(m.detail -> 'readingModes', '[]'::jsonb)) AS item)), NFKC))) = 0)
    )
    SELECT head.revision, head.baseline, coalesce((
      SELECT jsonb_agg(result ORDER BY result.section, result.ordinal) FROM (
        SELECT section, ordinal, detail FROM candidates
        WHERE ${expectedPublication ?? null}::text IS NULL OR head.revision = ${expectedPublication ?? null}
        ORDER BY section, ordinal LIMIT ${pageSize + 1} OFFSET ${after ? 0 : offset}
      ) AS result
    ), '[]'::jsonb) AS rows
    ${summary ? sql`, (SELECT to_jsonb(s) - 'singleton' FROM yomiru_public_vocabulary_summary AS s
      WHERE singleton) AS summary` : sql``}
    FROM head`;
  return result;
}

export async function readPostgresCatalogue(sql, query, revisionOnly = false) {
  const selection = browseSelection(null, query);
  if (revisionOnly && !selection.expectedPublication && !selection.show && !selection.search) {
    try {
      const [head] = await sql`SELECT revision AS publication FROM yomiru_incremental_head WHERE singleton AND serving`;
      return head;
    } catch (error) {
      if (error.code === "42P01" && error.message.includes("yomiru_incremental_head")) return undefined;
      throw error;
    }
  }
  const includeSummary = !selection.offset && !selection.show && Date.now() >= summaryRetryAt;
  let result;
  try {
    result = await queryCatalogue(sql, selection, includeSummary);
  } catch (error) {
    if (error.code !== "42P01") throw error;
    if (includeSummary && error.message.includes("yomiru_public_vocabulary_summary")) {
      summaryRetryAt = Date.now() + 30_000;
      result = await queryCatalogue(sql, selection, false);
    } else if (error.message.includes("yomiru_incremental_")) {
      return undefined;
    } else throw error;
  }
  if (!result) return undefined;
  const { revision, baseline, summary } = result;
  if (selection.expectedPublication && selection.expectedPublication !== revision) {
    throw new BrowseError("The library changed; reload its first page", 409);
  }
  const entries = result.rows.slice(0, pageSize);
  const supported = await readReviewedPracticeTitles(sql, revision,
    entries.flatMap(({ detail }) => detail.vocabulary ? [detail.id] : [])).catch(error => {
    reportServerError(error, "browse-practice-availability");
    return new Set();
  });
  const rows = entries.map(({ detail }) => ({
    ...detail,
    ...(revision !== baseline && detail.vocabulary && { vocabulary: { ...detail.vocabulary, registry: revision } }),
    ...(supported.has(detail.id) && { practiceSupported: true }),
  }));
  const last = entries.at(-1);
  const page = browsePage(rows, result.rows.length > pageSize, revision, selection,
    last && [last.section, last.ordinal]);
  if (summary) page.vocabularySummary = { publication: revision, total: summary.total,
    covered: summary.english ? { eng: summary.english } : {}, episodeCount: summary.episode_count,
    ...(summary.movie_count && { movieCount: summary.movie_count }) };
  return { publication: revision, page };
}
