import { subtitlePracticePositions } from "../src/practice-deck.mjs";

export function practiceSourceRevisions(sql, { episodes, publication }, verifyCurrent = false) {
  return sql`ARRAY(SELECT DISTINCT context.source_revision FROM yomiru_practice_context_title AS context
    ${verifyCurrent ? sql`
      JOIN yomiru_incremental_vocabulary AS vocabulary USING (video_id)
      JOIN yomiru_incremental_catalogue AS catalogue ON catalogue.id=context.video_id` : sql``}
    WHERE true
    ${verifyCurrent ? sql`AND vocabulary.anchor=context.anchor
      AND (vocabulary.manifest_sha256 IS NULL OR vocabulary.manifest_sha256=context.source_revision)
      AND catalogue.detail->>'unlisted' IS DISTINCT FROM 'true'`
      : publication ? sql`AND context.publication=${publication}` : sql``}
    ${episodes ? sql`AND context.video_id=ANY(${sql.array(episodes.map(({ id }) => id), 25)})` : sql``})`;
}

export async function hasEpisodePracticeTimings(sql, { episodes, practice, order }) {
  if (order !== "subtitle" || practice.after || !/^tt\d+:\d+:\d+$/.test(episodes[0].id)) return false;
  const [{ available }] = await sql`
    SELECT has_schema_privilege(to_regnamespace('yomiru_subtitle_corpus'), 'USAGE')
      AND has_table_privilege(to_regclass('yomiru_subtitle_corpus.source_cue'), 'SELECT') AS available`;
  return available;
}

export function episodePracticeTimeline(sql, revisions, candidates) {
  // A stop carries the cursor immediately before its question in subtitle order.
  return sql`(
    WITH timings AS MATERIALIZED (
      SELECT source_revision, cue_id, start_ms, end_ms
      FROM yomiru_subtitle_corpus.source_cue WHERE source_revision = ANY(${revisions})
    ), ordered AS (
      SELECT *, lag(jsonb_build_array(rank, word_id)) OVER (ORDER BY rank DESC) AS cursor
      FROM (${candidates}) AS candidates
    ), stops AS (
      SELECT DISTINCT ON (timing.start_ms) timing.start_ms, e.word_id, e.cursor
      FROM ordered AS e
      CROSS JOIN LATERAL (
        SELECT timing.start_ms FROM yomiru_practice_example AS example
        JOIN timings AS timing USING (source_revision, cue_id)
        WHERE example.word_id = e.word_id AND example.gloss_key = e.gloss_key
        ORDER BY (example.cue_id = e.cue_id) DESC, example.cue_id LIMIT 1
      ) AS timing
      ORDER BY timing.start_ms, e.rank DESC
    )
    SELECT jsonb_build_object('duration', max(end_ms), 'source', min(source_revision),
      'cues', jsonb_object_agg(cue_id, start_ms), 'stops',
      (SELECT jsonb_agg(jsonb_build_array(start_ms, word_id, cursor) ORDER BY start_ms) FROM stops))
    FROM timings HAVING count(DISTINCT source_revision) = 1
  )`;
}

export function practiceNameMeaning(sql, reference) {
  return sql`(
    SELECT (array_agg(id ORDER BY jmdict_entry_id))[1] AS id,
      string_agg(gloss, ' · ' ORDER BY jmdict_entry_id) AS gloss
    FROM (
      SELECT dictionary.id, dictionary.jmdict_entry_id, meaning.gloss
      FROM yomiru_incremental_dictionary AS dictionary
      CROSS JOIN LATERAL (
        SELECT btrim(value) AS gloss
        FROM jsonb_array_elements(dictionary.detail->'jmdictSenses') WITH ORDINALITY AS sense(item, position)
        CROSS JOIN LATERAL jsonb_array_elements_text(sense.item->'eng') WITH ORDINALITY AS entry(value, position)
        WHERE sense.item->'forms' ? (${reference}->>0) AND sense.item->'pos' ? '名詞'
          AND length(btrim(value)) BETWEEN 1 AND 100
        ORDER BY sense.position, entry.position LIMIT 1
      ) AS meaning
      WHERE dictionary.detail ? 'jmdictSenses' AND dictionary.detail->>'reading' = ${reference}->>1
      ORDER BY dictionary.jmdict_entry_id LIMIT 3
    ) AS candidates
    HAVING count(*) > 0
  )`;
}

function practiceWordPeeks(sql, target) {
  // Older databases can still serve the original seven-field examples before the peek migration.
  return sql`coalesce((
    SELECT jsonb_build_array(jsonb_agg(jsonb_build_array(
      meaning.id, meaning.gloss, span.item->1, span.item->2, span.item->3, span.item->4)
      ORDER BY span.position))
    FROM jsonb_array_elements(nullif(to_jsonb(cue)->'word_peeks', 'null'::jsonb))
      WITH ORDINALITY AS span(item, position)
    CROSS JOIN LATERAL (
      (SELECT dictionary.id, btrim(value) AS gloss
        FROM yomiru_incremental_dictionary AS dictionary
        CROSS JOIN LATERAL jsonb_array_elements_text(dictionary.detail #> '{meanings,eng}')
          WITH ORDINALITY AS entry(value, position)
        WHERE jsonb_typeof(span.item->0) = 'string' AND dictionary.id = span.item->>0
          AND length(btrim(value)) BETWEEN 1 AND 100
        ORDER BY position LIMIT 1)
      UNION ALL
      SELECT name.id, name.gloss FROM LATERAL ${practiceNameMeaning(sql, sql`(span.item->0)`)} AS name
      WHERE jsonb_typeof(span.item->0) = 'array'
    ) AS meaning
    WHERE meaning.id<> ${target}
    HAVING count(*) > 0
  ), '[]'::jsonb)`;
}

export function practiceExamples(sql, revisions, word, gloss, firstCue, lookupPeeks = true) {
  return sql`(
    SELECT jsonb_agg((jsonb_build_array(source_revision||':'||cue_id, hiragana, romaji,
      hiragana_start, hiragana_end, romaji_start, romaji_end)
      ${lookupPeeks ? sql`|| ${practiceWordPeeks(sql, word)}` : sql``})
      ORDER BY source_revision, cue_id)
    FROM (
      SELECT source_revision, cue_id, hiragana_start, hiragana_end, romaji_start, romaji_end
      FROM yomiru_practice_example
      WHERE source_revision=ANY(${revisions}) AND word_id=${word} AND gloss_key=${gloss}
      ORDER BY ${firstCue ? sql`(cue_id=${firstCue}) DESC NULLS LAST,` : sql``}
        source_revision, cue_id LIMIT ${firstCue ? 1 : 2}
    ) AS examples JOIN yomiru_practice_cue AS cue USING (source_revision, cue_id)
  )`;
}

function validSpans([hs, he, rs, re], [kanaLength, romajiLength] = []) {
  return [hs, he, rs, re].every(Number.isSafeInteger)
    && 0 <= hs && hs < he && he <= kanaLength && 0 <= rs && rs < re && re <= romajiLength;
}

export function practiceProjectionRows(sql, { sourceRevision, cues, examples }) {
  const lengths = new Map();
  const cueRows = cues.map(([cue_id, kana, romaji, peeks]) => {
    const sizes = [[...kana].length, [...romaji].length];
    lengths.set(cue_id, sizes);
    if (peeks !== undefined) {
      let kanaEnd = 0, romajiEnd = 0;
      if (!Array.isArray(peeks)) throw new Error(`Invalid word peeks for ${cue_id}`);
      for (const [word, hs, he, rs, re] of peeks) {
        const validWord = Array.isArray(word)
          ? word.length === 2 && word.every(value => typeof value === "string" && value.length > 0)
          : typeof word === "string" && word.length > 0;
        if (!validWord || !validSpans([hs, he, rs, re], sizes)
          || hs < kanaEnd || rs < romajiEnd) {
          throw new Error(`Invalid word peek for ${cue_id}`);
        }
        kanaEnd = he;
        romajiEnd = re;
      }
    }
    // Keep the existing column name while serving mixed kana from new projections.
    return { source_revision: sourceRevision, cue_id, hiragana: kana, romaji,
      word_peeks: peeks === undefined ? null : sql.json(peeks) };
  });
  const exampleRows = examples.map(([cue_id, word_id, gloss_key, hs, he, rs, re]) => {
    if (!validSpans([hs, he, rs, re], lengths.get(cue_id))) {
      throw new Error(`Invalid practice highlight for ${cue_id}`);
    }
    return { source_revision: sourceRevision, cue_id, word_id, gloss_key,
      hiragana_start: hs, hiragana_end: he, romaji_start: rs, romaji_end: re };
  });
  return { cueRows, exampleRows };
}

export async function addLocalPracticeExamples(sql, page, selection, pilotRevision, cues, roster) {
  const cards = [...page.cards, ...page.reviews];
  if (!cards.length) return page;
  const selected = practiceSourceRevisions(sql, selection);
  const revisions = pilotRevision && !cues ? sql`(CASE WHEN EXISTS (SELECT 1 FROM yomiru_practice_context_title)
    THEN ${selected} ELSE ARRAY[${pilotRevision}::text] END)` : selected;
  const firstCues = cues && Object.fromEntries(cards.map(([id]) => [id, cues.get(id)]));
  const [{ dictionary }] = await sql`SELECT to_regclass('yomiru_incremental_dictionary') IS NOT NULL AS dictionary`;
  const results = await sql`
    SELECT ${practiceExamples(sql, revisions, sql`card.item->>0`, sql`card.item->>5`,
      firstCues && sql`${sql.json(firstCues)}::jsonb->>(card.item->>0)`, dictionary)} AS examples
    FROM jsonb_array_elements(${sql.json(cards)}::jsonb) WITH ORDINALITY AS card(item, position)
    ORDER BY card.position`;
  const enriched = cards.map((card, index) => results[index].examples
    ? [...card.slice(0, 10), results[index].examples, ...card.slice(11)] : card);
  let timeline;
  if (roster && await hasEpisodePracticeTimings(sql, selection)) {
    const glosses = new Map(roster.cards.map(({ id, meaningKey }) => [id, meaningKey]));
    const positions = subtitlePracticePositions(roster.words.filter(({ id }) => glosses.has(id)));
    const candidates = positions.map(({ id, cue }, index) => ({
      word_id: id, cue_id: cue, rank: positions.length - index, gloss_key: glosses.get(id),
    }));
    [{ timeline }] = await sql`SELECT ${episodePracticeTimeline(sql, revisions, sql`
      SELECT * FROM jsonb_to_recordset(${sql.json(candidates)}::jsonb)
        AS entries(word_id text, cue_id text, rank int, gloss_key text)`)} AS timeline`;
  }
  return { ...page, cards: enriched.slice(0, page.cards.length), reviews: enriched.slice(page.cards.length),
    ...(timeline?.stops?.length && { timeline }) };
}
