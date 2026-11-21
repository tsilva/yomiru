import { episodeRenderedTrack, episodeTranslations, hasEpisodeTranslations,
  hasPracticeSourceTimings, practiceWordPeeks } from "./practice-context.mjs";
import { packPracticeCard, practiceMembership, practicePageSize } from "../src/practice-deck.mjs";

export function practicePhraseBatch(sql, { episodes, publication, practice: { after } },
  { local = false, rank, archived } = {}) {
  const ids = episodes.map(({ id }) => id);
  const cards = local ? sql`roster` : sql`yomiru_public_practice_card`;
  const gloss = local ? sql`card.meaning_key` : sql`yomiru_practice_key(card.meaning)`;
  const cues = archived ? sql`(
    SELECT ${archived.source}::text AS source_revision, line->>0 AS cue_id,
      line->>1 AS hiragana, line->>2 AS romaji, line->3 AS word_peeks
      ${archived.wordIds ? sql`, line->>4 AS paired_translation, line->5 AS prepared_targets` : sql``}
    FROM jsonb_array_elements(${sql.json(archived.cues)}::jsonb) AS item(line)
  )` : sql`yomiru_practice_cue`;
  return sql`
    SELECT source.rank, source.video_id, cue.source_revision, cue.cue_id,
      cue.hiragana, cue.romaji, nullif(to_jsonb(cue)->'word_peeks', 'null'::jsonb) AS word_peeks, words.targets
      ${archived?.wordIds ? sql`, cue.paired_translation` : sql``}
    FROM (
      SELECT context.video_id, context.source_revision, ${ids.length}::int + 1 - requested.position AS rank
      FROM unnest(${sql.array(ids, 25)}::text[]) WITH ORDINALITY AS requested(video_id, position)
      JOIN yomiru_practice_context_title AS context USING (video_id)
      ${local ? sql`WHERE context.publication = ${publication}` : sql`
        JOIN yomiru_incremental_vocabulary AS vocabulary USING (video_id)
        WHERE vocabulary.anchor = context.anchor AND
          (vocabulary.manifest_sha256 IS NULL OR vocabulary.manifest_sha256 = context.source_revision)`}
    ) AS source
    JOIN ${cues} AS cue USING (source_revision)
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(span ORDER BY (span->>1)::int, (span->>3)::int, span->>0) AS targets
      FROM (
        ${archived?.wordIds ? sql`SELECT span FROM jsonb_array_elements(cue.prepared_targets) AS token(span)` : sql`
        SELECT span FROM jsonb_array_elements(
          nullif(to_jsonb(cue)->'word_peeks', 'null'::jsonb)
        ) AS token(span)
        WHERE jsonb_typeof(span->0) = 'string'
        UNION ALL
        -- Earlier projections only saved example offsets.
        SELECT jsonb_build_array(word_id, hiragana_start, hiragana_end, romaji_start, romaji_end)
        FROM yomiru_practice_example AS example
        WHERE nullif(to_jsonb(cue)->'word_peeks', 'null'::jsonb) IS NULL
          AND example.source_revision = cue.source_revision AND example.cue_id = cue.cue_id
          AND EXISTS (SELECT 1 FROM ${cards} AS card WHERE card.word_id = example.word_id
            AND ${gloss} = example.gloss_key)`}
      ) AS spans
      WHERE EXISTS (SELECT 1 FROM ${cards} AS card WHERE card.word_id = span->>0)
        ${archived?.supplementalCards?.length ? sql`OR (span->>0)
          = ANY(${sql.array(archived.supplementalCards.map(([id]) => id), 25)})` : sql``}
    ) AS words
    WHERE (SELECT valid FROM selection) AND words.targets IS NOT NULL
      ${rank ? sql`AND source.rank = ${rank}::bigint` : sql``}
      ${after ? sql`AND (source.rank < ${after[0]}::bigint OR
        (source.rank = ${after[0]}::bigint AND cue.cue_id COLLATE "C" > ${after[1]}))` : sql``}
    ORDER BY source.rank DESC, cue.cue_id COLLATE "C" LIMIT ${practicePageSize + 1}`;
}

export function practicePhraseDetails(sql, request, { translations, timed, lookups = true, local = false, prepared = false }) {
  const revisions = sql`ARRAY[cue.source_revision]`;
  const title = { ...request, videoId: sql`cue.video_id` };
  const key = sql`cue.source_revision||':'||cue.cue_id`;
  const translated = prepared ? sql`cue.paired_translation` : translations
    ? sql`(SELECT translation FROM (${episodeTranslations(sql, revisions, title, key, local)}) AS line)`
    : sql`NULL::text`;
  return sql`coalesce((
    SELECT jsonb_agg(jsonb_build_object('cue', ${key}, 'kana', cue.hiragana, 'romaji', cue.romaji,
      'targets', cue.targets, 'peeks', ${lookups ? sql`${practiceWordPeeks(sql, sql`NULL::text`)}->0` : sql`NULL`},
      'translation', translated.text, 'rank', cue.rank
      ${timed ? sql`, 'time', timing.start_ms,
        'duration', (SELECT max(end_ms) FROM yomiru_subtitle_corpus.source_cue WHERE source_revision=cue.source_revision)` : sql``}
      ${timed && !local ? sql`, 'rendered', CASE WHEN translated.text IS NULL AND timing.start_ms IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM yomiru_subtitle_corpus.source_cue AS duplicate
          WHERE duplicate.source_revision=cue.source_revision AND duplicate.cue_id<>cue.cue_id
            AND ((duplicate.start_ms+5)/10, (duplicate.end_ms+5)/10)
              = ((timing.start_ms+5)/10, (timing.end_ms+5)/10)
        ) THEN jsonb_build_object('track', ${episodeRenderedTrack(sql, revisions, title)},
          'timings', jsonb_build_array((timing.start_ms+5)/10, (timing.end_ms+5)/10)) END` : sql``}
      ) ORDER BY cue.rank DESC, cue.cue_id COLLATE "C")
    FROM batch AS cue
    ${timed ? sql`LEFT JOIN yomiru_subtitle_corpus.source_cue AS timing USING (source_revision, cue_id)` : sql``}
    CROSS JOIN LATERAL (SELECT ${translated} AS text OFFSET 0) AS translated
  ), '[]'::jsonb)`;
}

export function finishPhrasePage(result, rank) {
  const { phrases } = result;
  const last = phrases[practicePageSize - 1];
  return { ...result, phrases: phrases.slice(0, practicePageSize), reviews: [],
    next: phrases.length > practicePageSize ? [last.rank, last.cue.split(":")[1]]
      : rank > 1 ? [rank - 1, "c00000"] : null };
}

export async function readLocalPracticePhrases(sql, request, cards) {
  const timed = await hasPracticeSourceTimings(sql);
  const translations = timed && await hasEpisodeTranslations(sql);
  const [{ lookups }] = await sql`SELECT to_regclass('yomiru_incremental_dictionary') IS NOT NULL AS lookups`;
  const roster = cards.map(card => [card.id, card.meaningKey]);
  const [{ phrases }] = await sql`
    WITH selection AS (SELECT true AS valid), roster AS MATERIALIZED (
      SELECT row->>0 AS word_id, row->>1 AS meaning_key FROM jsonb_array_elements(${sql.json(roster)}::jsonb) AS item(row)
    ), batch AS MATERIALIZED (${practicePhraseBatch(sql, request, { local: true })})
    SELECT ${practicePhraseDetails(sql, request, { timed, translations, lookups, local: true })} AS phrases`;
  const byId = new Map(cards.map(card => [card.id, card]));
  const checked = request.practice.checks.map(([id, reading, meaning]) => practiceMembership(byId.get(id), reading, meaning)).join("");
  const options = new Set(phrases.flatMap(phrase => phrase.targets.map(([id]) => id)));
  for (const card of cards.slice(0, 48)) options.add(card.id);
  const page = finishPhrasePage({ total: cards.length, checked, cards: [...options].map(id => packPracticeCard(byId.get(id))), phrases });
  return { ...page, phrases: page.phrases.map(({ rank, ...phrase }) => phrase) };
}
