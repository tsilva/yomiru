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
  return hasPracticeSourceTimings(sql);
}

export async function hasPracticeSourceTimings(sql) {
  const [{ available }] = await sql`
    SELECT has_schema_privilege(to_regnamespace('yomiru_subtitle_corpus'), 'USAGE')
      AND has_table_privilege(to_regclass('yomiru_subtitle_corpus.source_cue'), 'SELECT') AS available`;
  return available;
}

export async function hasPracticeSourceWords(sql) {
  const [{ available }] = await sql`
    SELECT has_table_privilege(to_regclass('yomiru_subtitle_corpus.source'), 'SELECT') AS available`;
  return available;
}

function episodePromptCues(sql, revisions, candidates) {
  return sql`
    SELECT candidate.*, prompt.source_revision, prompt.cue_id AS prompt_cue
    FROM (${candidates}) AS candidate
    CROSS JOIN LATERAL (
      SELECT source_revision, cue_id FROM yomiru_practice_example
      WHERE source_revision=ANY(${revisions}) AND word_id=candidate.word_id AND gloss_key=candidate.gloss_key
      ORDER BY (cue_id=candidate.cue_id) DESC NULLS LAST, source_revision, cue_id LIMIT 1
    ) AS prompt`;
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
      FROM (${episodePromptCues(sql, revisions, sql`SELECT * FROM ordered`)}) AS e
      JOIN timings AS timing ON timing.source_revision=e.source_revision AND timing.cue_id=e.prompt_cue
      ORDER BY timing.start_ms, e.rank DESC
    )
    SELECT jsonb_build_object('duration', max(end_ms), 'source', min(source_revision),
      'cues', jsonb_object_agg(cue_id, start_ms), 'stops',
      (SELECT jsonb_agg(jsonb_build_array(start_ms, word_id, cursor) ORDER BY start_ms) FROM stops))
    FROM timings HAVING count(DISTINCT source_revision) = 1
  )`;
}

export async function hasEpisodeTranslations(sql) {
  const [{ available }] = await sql`
    SELECT has_schema_privilege(to_regnamespace('yomiru_subtitle_corpus'), 'USAGE')
      AND has_table_privilege(to_regclass('yomiru_subtitle_corpus.choice'), 'SELECT')
      AND has_table_privilege(to_regclass('yomiru_subtitle_corpus.translation'), 'SELECT')
      AND has_table_privilege(to_regclass('yomiru_subtitle_corpus.translation_cue'), 'SELECT')
      AND has_table_privilege(to_regclass('yomiru_subtitle_corpus.source_cue'), 'SELECT') AS available`;
  return available;
}

function episodeTranslationChoice(sql, revisions, { episodes, videoId, publication }, local) {
  const id = videoId ?? sql`${episodes[0].id}`;
  return sql`SELECT t.id, t.provenance, t.source_revision
  FROM yomiru_subtitle_corpus.choice AS choice
  JOIN yomiru_subtitle_corpus.translation AS t ON t.id=choice.translation_id
  WHERE choice.video_id=${id} AND choice.language='eng' AND t.source_revision=ANY(${revisions})
  ${local ? sql`AND choice.publication=${publication}` : sql`AND EXISTS (
    SELECT 1 FROM yomiru_incremental_track_video AS binding
    JOIN yomiru_incremental_track AS track ON track.id=binding.track_id
    WHERE binding.video_id=choice.video_id AND track.detail->>'generation'=t.generation
      AND track.detail->>'lang'='eng' AND track.detail->>'superseded' IS DISTINCT FROM 'true'
  )`}
  ORDER BY (choice.publication=${publication}) DESC, (t.provenance='paired') DESC, t.id
  LIMIT 1`;
}

export function hasEpisodeTranslationChoice(sql, revisions, request) {
  return sql`EXISTS (${episodeTranslationChoice(sql, revisions, request, false)})`;
}

export function episodeTranslations(sql, revisions, request, cue, local = false) {
  return sql`
    WITH preferred AS (${episodeTranslationChoice(sql, revisions, request, local)})
    SELECT preferred.source_revision||':'||source.cue_id AS cue, min(line.text) AS translation
    FROM preferred
    JOIN yomiru_subtitle_corpus.source_cue AS source USING (source_revision)
    JOIN yomiru_subtitle_corpus.translation_cue AS line ON line.translation_id=preferred.id
      AND (preferred.provenance='paired' AND line.cue_id=source.cue_id
        OR preferred.provenance='rendered' AND (line.start_ms, line.end_ms)
          = (((source.start_ms+5)/10)*10, ((source.end_ms+5)/10)*10)
          AND NOT EXISTS (
            SELECT 1 FROM yomiru_subtitle_corpus.source_cue AS duplicate
            WHERE duplicate.source_revision=source.source_revision AND duplicate.cue_id<>source.cue_id
              AND ((duplicate.start_ms+5)/10, (duplicate.end_ms+5)/10)
                = ((source.start_ms+5)/10, (source.end_ms+5)/10)
          ))
    WHERE btrim(line.text) <> ''
      ${cue ? sql`AND preferred.source_revision||':'||source.cue_id=${cue}` : sql``}
    GROUP BY preferred.source_revision, source.cue_id
    HAVING count(DISTINCT line.text)=1`;
}

export function episodePracticeLines(sql, revisions, candidates, request, local = false) {
  return sql`(
    SELECT jsonb_object_agg(cue, words) FROM (
      SELECT line.cue, jsonb_agg(target.word_id ORDER BY target.rank DESC) AS words
      FROM (${episodeTranslations(sql, revisions, request, null, local)}) AS line
      JOIN (${episodePromptCues(sql, revisions, candidates)}) AS target
        ON line.cue=target.source_revision||':'||target.prompt_cue
      GROUP BY line.cue
    ) AS lines
  )`;
}

export async function readLocalPracticeTranslation(sql, request) {
  if (!await hasEpisodeTranslations(sql)) return null;
  const [line] = await sql`${episodeTranslations(sql, practiceSourceRevisions(sql, request),
    request, request.cue, true)}`;
  return line?.translation ?? null;
}

export function episodePracticeTranslation(sql, revisions, request) {
  return sql`(SELECT translation FROM (${episodeTranslations(sql, revisions, request, request.cue, false)}) AS line)`;
}

export function episodeRenderedTrack(sql, revisions, { episodes, videoId }) {
  const id = videoId ?? sql`${episodes[0].id}`;
  return sql`(
    SELECT track.detail FROM yomiru_incremental_track_video AS binding
    JOIN yomiru_incremental_track AS track ON track.id=binding.track_id
    JOIN yomiru_practice_context_title AS context ON context.video_id=binding.video_id
    WHERE binding.video_id=${id} AND context.source_revision=ANY(${revisions})
      AND track.detail->>'anchor'=context.anchor AND track.detail->>'lang'='eng'
      AND track.detail->>'superseded' IS DISTINCT FROM 'true'
      AND track.detail->>'path' ~ '^/library/[a-f0-9]{64}[.]ass$'
      AND EXISTS (
        SELECT 1 FROM yomiru_practice_example AS example
        JOIN yomiru_subtitle_corpus.source_cue AS cue USING (source_revision, cue_id)
        WHERE example.source_revision=context.source_revision
      )
    ORDER BY (track.detail->>'script'='japanese') DESC NULLS LAST, track.ordinal DESC
    LIMIT 1
  )`;
}

export function episodeRenderedTimings(sql, revisions, candidates, cue) {
  const filter = cue?.split(":");
  return sql`(
    WITH timings AS MATERIALIZED (
      SELECT source_revision, cue_id, (start_ms+5)/10 AS start, (end_ms+5)/10 AS stop,
        count(*) OVER (PARTITION BY source_revision, (start_ms+5)/10, (end_ms+5)/10) AS matches
      FROM yomiru_subtitle_corpus.source_cue WHERE source_revision=ANY(${revisions})
    )
    ${filter ? sql`
      SELECT jsonb_build_array(start,stop) FROM timings
      WHERE source_revision=${filter[0]} AND cue_id=${filter[1]} AND matches=1` : sql`
      SELECT jsonb_object_agg(example, jsonb_build_array(start,stop,words)) FROM (
        SELECT timing.source_revision||':'||timing.cue_id AS example, timing.start, timing.stop,
          jsonb_agg(target.word_id ORDER BY target.rank DESC) AS words
        FROM timings AS timing
        JOIN (${episodePromptCues(sql, revisions, candidates)}) AS target
          ON target.source_revision=timing.source_revision AND target.prompt_cue=timing.cue_id
        WHERE timing.matches=1 GROUP BY timing.source_revision,timing.cue_id,timing.start,timing.stop
      ) AS grouped`}
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

export function practiceWordPeeks(sql, target, supplemental = sql`'{}'::jsonb`) {
  // Older databases can still serve the original seven-field examples before the peek migration.
  return sql`coalesce((
    SELECT jsonb_build_array(jsonb_agg(jsonb_build_array(
      meaning.id, meaning.gloss, span.item->1, span.item->2, span.item->3, span.item->4, meaning.written)
      ORDER BY span.position))
    FROM jsonb_array_elements(nullif(to_jsonb(cue)->'word_peeks', 'null'::jsonb))
      WITH ORDINALITY AS span(item, position)
    CROSS JOIN LATERAL (
      SELECT span.item->>0 AS id,
        coalesce(span.item->>6, lookup.gloss, (${supplemental}::jsonb->(span.item->>0))->>0) AS gloss,
        coalesce(span.item->>5, lookup.written, (${supplemental}::jsonb->(span.item->>0))->>1) AS written
      FROM (SELECT 1) AS word
      LEFT JOIN LATERAL (
        SELECT btrim(value) AS gloss, dictionary.detail->>'word' AS written
        FROM yomiru_incremental_dictionary AS dictionary
        CROSS JOIN LATERAL jsonb_array_elements_text(dictionary.detail #> '{meanings,eng}')
          WITH ORDINALITY AS entry(value, position)
        WHERE dictionary.id = span.item->>0 AND length(btrim(value)) BETWEEN 1 AND 100
        ORDER BY position LIMIT 1
      ) AS lookup ON true
      WHERE jsonb_typeof(span.item->0) = 'string'
      UNION ALL
      SELECT name.id, name.gloss, span.item->0->>0 FROM LATERAL ${practiceNameMeaning(sql, sql`(span.item->0)`)} AS name
      WHERE jsonb_typeof(span.item->0) = 'array'
    ) AS meaning
    WHERE meaning.gloss IS NOT NULL AND meaning.id IS DISTINCT FROM ${target}
    HAVING count(*) > 0
  ), '[]'::jsonb)`;
}

export function practiceExamples(sql, revisions, word, gloss, firstCue, lookupPeeks = true, alternatives = false) {
  return sql`(
    SELECT jsonb_agg((jsonb_build_array(source_revision||':'||cue_id, hiragana, romaji,
      hiragana_start, hiragana_end, romaji_start, romaji_end)
      ${lookupPeeks ? sql`|| ${practiceWordPeeks(sql, word)}` : sql``})
      ORDER BY ${firstCue && alternatives ? sql`(cue_id=preferred) DESC NULLS LAST,` : sql``} source_revision, cue_id)
    FROM (
      SELECT source_revision, cue_id, hiragana_start, hiragana_end, romaji_start, romaji_end
        ${firstCue && alternatives ? sql`, ${firstCue} AS preferred` : sql``}
      FROM yomiru_practice_example
      WHERE source_revision=ANY(${revisions}) AND word_id=${word} AND gloss_key=${gloss}
      ORDER BY ${firstCue ? sql`(cue_id=${firstCue}) DESC NULLS LAST,` : sql``}
        source_revision, cue_id LIMIT ${firstCue && !alternatives ? 1 : 2}
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
      firstCues && sql`${sql.json(firstCues)}::jsonb->>(card.item->>0)`, dictionary, Boolean(roster))} AS examples
    FROM jsonb_array_elements(${sql.json(cards)}::jsonb) WITH ORDINALITY AS card(item, position)
    ORDER BY card.position`;
  const enriched = cards.map((card, index) => results[index].examples
    ? [...card.slice(0, 10), results[index].examples, ...card.slice(11)] : card);
  let timeline, lines;
  if (roster && !selection.practice?.after) {
    const glosses = new Map(roster.cards.map(({ id, meaningKey }) => [id, meaningKey]));
    const positions = subtitlePracticePositions(roster.words.filter(({ id }) => glosses.has(id)));
    const candidates = positions.map(({ id, cue }, index) => ({
      word_id: id, cue_id: cue, rank: positions.length - index, gloss_key: glosses.get(id),
    }));
    const entries = sql`SELECT * FROM jsonb_to_recordset(${sql.json(candidates)}::jsonb)
      AS entries(word_id text, cue_id text, rank int, gloss_key text)`;
    if (await hasEpisodePracticeTimings(sql, selection)) {
      [{ timeline }] = await sql`SELECT ${episodePracticeTimeline(sql, revisions, entries)} AS timeline`;
    }
    if (await hasEpisodeTranslations(sql)) {
      [{ lines }] = await sql`SELECT ${episodePracticeLines(sql, revisions, entries, selection, true)} AS lines`;
    }
  }
  return { ...page, cards: enriched.slice(0, page.cards.length), reviews: enriched.slice(page.cards.length),
    ...(timeline?.stops?.length && { timeline }), ...(lines && { lines }) };
}
