import { conjugationVerbGroup } from "./conjugations.mjs";
import { createHash } from "node:crypto";
import {
  filterVocabulary, sortVocabulary, sortVocabularyByColumn, vocabularyCategoryMap, vocabularyPageSize, vocabularySearchTerms,
} from "../src/vocabulary-study.mjs";
import { sequenceMovies } from "./browse.mjs";
import { bundledReviewedSources, hasStoredPracticeReviews, readArchivedPhraseCues,
  reviewedPracticeTitles, ReviewedPracticeUnavailable } from "./archived-practice.mjs";
import { episodePracticeLines, episodePracticeTimeline, episodePracticeTranslation,
  episodeRenderedTimings, episodeRenderedTrack, hasEpisodeTranslationChoice, hasEpisodeTranslations,
  hasPracticeSourceTimings, hasPracticeSourceWords, practiceExamples, practiceSourceRevisions }
  from "./practice-context.mjs";
import { finishPhrasePage, practicePhraseBatch, practicePhraseDetails } from "./practice-phrases.mjs";
import { reportServerError } from "./sentry-server.mjs";
import { practiceEligibility, practicePageSize, practiceReviewSize } from "../src/practice-deck.mjs";
import { isPracticePartOfSpeech } from "../src/vocabulary-practice.mjs";

const removedMarks = Array.from({ length: 0x70 }, (_, index) => String.fromCodePoint(0x300 + index)).join("");
const kana = start => Array.from({ length: 86 }, (_, index) => String.fromCodePoint(start + index)).join("");
const katakana = kana(0x30a1), hiragana = kana(0x3041);
const vocabularyIndexPageSize = 20_000;

function scope(sql, { episodes, publication, mode, scope: selectionScope }) {
  return sql`
    head AS MATERIALIZED (
      SELECT baseline, revision FROM yomiru_incremental_head WHERE singleton AND serving
    ),
    selected AS MATERIALIZED (
      SELECT v.video_id ${mode === "csv" ? sql`, c.detail, v.anchor, v.header -> 'dictionary' AS source` : sql``}
      FROM yomiru_incremental_vocabulary AS v
      JOIN yomiru_incremental_catalogue AS c ON c.id = v.video_id
      CROSS JOIN head
      ${selectionScope === "titles" ? sql`
        JOIN jsonb_array_elements_text(${sql.json(episodes.map(row => row.id))}::jsonb) AS requested(id)
          ON requested.id = v.video_id
      ` : episodes ? sql`
        JOIN jsonb_to_recordset(${sql.json(episodes)}::jsonb) AS requested(id text, revision text, registry text)
          ON requested.id = v.video_id AND requested.revision = v.descriptor ->> 'sha256'
          AND requested.registry IS NOT DISTINCT FROM
            CASE WHEN head.revision = head.baseline THEN v.header ->> 'registry' ELSE head.revision END
      ` : sql``}
      WHERE c.detail ->> 'unlisted' IS DISTINCT FROM 'true'
    ),
    selection AS (
      SELECT head.revision, (
        ${publication ? sql`head.revision = ${publication}` : sql`true`}
        ${episodes ? sql`AND (SELECT count(*) FROM selected) = ${episodes.length}::integer` : sql``}
      ) AS valid
      FROM head
    )`;
}

export async function readVocabularyExport(sql, request) {
  const [result] = await sql`
    WITH ${scope(sql, request)}, occurrences AS MATERIALIZED (${occurrences(sql)})
    SELECT revision, valid,
      coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', word_id, 'word', d.detail -> 'word',
        'reading', d.detail -> 'reading', 'romaji', d.detail -> 'romaji', 'pos', d.detail -> 'pos',
        'meanings', jsonb_build_object('eng', coalesce(d.detail #> '{meanings,eng}', '[]'::jsonb)),
        'meaningStatus', d.detail -> 'meaningStatus', 'sources', d.detail -> 'sources',
        'dictionaries', d.detail -> 'dictionaries')))
        FROM (SELECT DISTINCT word_id FROM occurrences) AS words
        JOIN yomiru_incremental_dictionary AS d ON d.id = words.word_id), '[]'::jsonb) AS dictionary,
      coalesce((SELECT jsonb_agg(jsonb_build_object('title', s.detail, 'anchor', s.anchor,
        'dictionary', s.source, 'words', coalesce(words.words, '[]'::jsonb)))
        FROM selected AS s
        LEFT JOIN (
          SELECT video_id, jsonb_agg(jsonb_build_object('id', word_id, 'count', detail -> 'count',
            'forms', detail -> 'forms', 'example', detail -> 'examples' -> 0) ORDER BY word_id) AS words
          FROM occurrences GROUP BY video_id
        ) AS words USING (video_id)), '[]'::jsonb) AS titles
    FROM selection`;
  if (!result || !result.valid) return result;
  const dictionary = new Map(result.dictionary.map(word => [word.id, word]));
  const byTitle = new Map(result.titles.map(row => [row.title.id, row]));
  const titles = request.episodes ? request.episodes.map(({ id }) => byTitle.get(id).title) : [
    ...result.titles.map(({ title }) => title).filter(title => title.type !== "movie")
      .sort((a, b) => a.show.localeCompare(b.show) || a.id.split(":")[0].localeCompare(b.id.split(":")[0])
        || a.season - b.season || a.episode - b.episode),
    ...sequenceMovies(result.titles.map(({ title }) => title).filter(title => title.type === "movie")),
  ];
  const documents = new Map();
  for (const title of titles) {
    const { anchor, dictionary: source, words } = byTitle.get(title.id);
    documents.set(title.id, { anchor, dictionary: source, words: words.map(({ id, count, forms, example }) => ({
      ...dictionary.get(id), count, forms: forms ?? [], examples: example ? [example] : [],
    })) });
  }
  return { revision: result.revision, valid: true,
    titles: titles.map(title => ({ ...title, vocabulary: {
      sha256: title.id, anchor: documents.get(title.id).anchor,
    } })), documents };
}

function occurrences(sql) {
  return sql`
    SELECT o.video_id, o.word_id, o.detail
    FROM selected JOIN yomiru_incremental_occurrence AS o ON o.video_id = selected.video_id
    WHERE (SELECT valid FROM selection)`;
}

export async function readConjugationDeck(sql, request) {
  const [result] = await sql`
    WITH ${scope(sql, request)}, verbs AS (
      ${request.mode === "conjugation-review" ? sql`
        SELECT d.id AS word_id, 0 AS count
        FROM yomiru_incremental_dictionary AS d
        WHERE d.id = ANY(${sql.array(request.wordIds, 25)})
          AND (SELECT valid FROM selection)
          AND EXISTS (
            SELECT 1 FROM yomiru_incremental_occurrence AS o
            JOIN selected USING (video_id) WHERE o.word_id = d.id
          )
      ` : sql`
        SELECT word_id, (detail ->> 'count')::integer AS count FROM (${occurrences(sql)}) AS episode_words
      `}
    ), ready AS (
      SELECT d.id, d.detail ->> 'word' AS written, d.detail ->> 'reading' AS kana,
        d.detail ->> 'romaji' AS romaji, d.detail #>> '{meanings,eng,0}' AS meaning,
        verbs.count, prepared.forms
      FROM verbs JOIN yomiru_incremental_dictionary AS d ON d.id = verbs.word_id
      CROSS JOIN LATERAL (
        SELECT (array_agg(p.forms))[1] AS forms
        FROM (
          SELECT DISTINCT source.detail -> 'conjugations' -> (d.detail ->> 'word') AS forms
          FROM yomiru_incremental_dictionary AS source
          WHERE source.detail ? 'jmdictSenses'
            AND source.detail ->> 'reading' = d.detail ->> 'reading'
            AND source.detail -> 'conjugations' ? (d.detail ->> 'word')
            AND (d.jmdict_entry_id IS NULL OR d.jmdict_entry_id = source.jmdict_entry_id)
        ) AS p
        HAVING count(*) = 1
      ) AS prepared
      WHERE split_part(d.detail ->> 'pos', '/', 1) = '動詞'
        AND nullif(d.detail ->> 'romaji', '') IS NOT NULL
        AND nullif(d.detail #>> '{meanings,eng,0}', '') IS NOT NULL
    )
    SELECT revision, valid, coalesce((SELECT jsonb_agg(to_jsonb(ready) ORDER BY count DESC, id COLLATE "C")
      FROM ready), '[]'::jsonb) AS verbs
    FROM selection`;
  if (!result) return { valid: false };
  return { ...result, verbs: result.verbs.map(verb => ({ ...verb,
    verbGroup: conjugationVerbGroup(verb.kana, verb.forms) })) };
}

function normalizedSearch(sql, value) {
  return sql`translate(normalize(translate(lower(normalize(${value}, NFKC) COLLATE "und-x-icu"),
    ${katakana}, ${hiragana}), NFD), ${removedMarks}, '')`;
}

function sourceForms(sql) {
  return sql`
    SELECT 'forms' AS kind, value FROM jsonb_array_elements_text(NULLIF(occurrence.detail -> 'forms', 'null'::jsonb))
    UNION ALL
    SELECT 'formReadings', value FROM jsonb_array_elements_text(NULLIF(occurrence.detail -> 'formReadings', 'null'::jsonb))`;
}

function mayMatchForm(sql) {
  return sql`(position(needle.term IN ${normalizedSearch(sql, sql`form.value`)}) > 0
    OR (needle.romaji AND normalize(form.value, NFKC) COLLATE "C" ~ '^[ぁ-ゖァ-ヺー]+$'))`;
}

function searchCandidates(sql, terms, byCategory, category, useTotals) {
  const forms = useTotals ? sql`
    SELECT form.value ->> 0 AS word_id, form.value ->> 1 AS kind, form.value ->> 2 AS value
    FROM selected JOIN yomiru_public_title_forms AS title USING (video_id)
    CROSS JOIN LATERAL jsonb_array_elements(title.forms) AS form
    WHERE (SELECT valid FROM selection)
  ` : sql`
    SELECT occurrence.word_id, form.kind, form.value
    FROM (${occurrences(sql)}) AS occurrence CROSS JOIN LATERAL (${sourceForms(sql)}) AS form`;
  const searchText = useTotals ? sql`lexeme.search_text` : normalizedSearch(sql, sql`concat_ws(' ',
    dictionary.detail ->> 'word', dictionary.detail ->> 'reading', dictionary.detail ->> 'romaji',
    (SELECT string_agg(value, ' ') FROM jsonb_array_elements_text(NULLIF(dictionary.detail -> 'aliases', 'null'::jsonb))),
    (SELECT string_agg(value, ' ') FROM jsonb_array_elements_text(dictionary.detail #> '{meanings,eng}')))`);
  return sql`
    needles AS MATERIALIZED (
      SELECT term, term COLLATE "C" ~ '^[a-z''-]+$' AS romaji
      FROM jsonb_array_elements_text(${sql.json(terms)}::jsonb) AS needle(term)
    ),
    available_forms AS MATERIALIZED (
      SELECT DISTINCT word_id, kind, value FROM (${forms}) AS forms
    ),
    matching_form_values AS MATERIALIZED (
      SELECT form.value, array_agg(needle.term) AS terms
      FROM (SELECT DISTINCT value FROM available_forms) AS form CROSS JOIN needles AS needle
      WHERE ${mayMatchForm(sql)} GROUP BY form.value
    ),
    candidate_forms AS MATERIALIZED (
      SELECT f.*, m.terms FROM available_forms AS f JOIN matching_form_values AS m USING (value)
    ),
    form_matches AS MATERIALIZED (
      SELECT form.word_id, array_agg(DISTINCT term) AS terms
      FROM candidate_forms AS form CROSS JOIN LATERAL unnest(form.terms) AS term GROUP BY form.word_id
    ),
    dictionary_search AS MATERIALIZED (
      SELECT words.*, ${searchText} AS text FROM counts AS words
      ${useTotals ? sql`JOIN yomiru_public_lexeme AS lexeme USING (word_id)` : sql``}
      ${(!useTotals || category) ? sql`JOIN yomiru_incremental_dictionary AS dictionary ON dictionary.id = words.word_id` : sql``}
      ${category ? sql`WHERE ${byCategory} = ${category}` : sql``}
    ),
    matching AS MATERIALIZED (
      SELECT dictionary_search.word_id, dictionary_search.count FROM dictionary_search
      LEFT JOIN form_matches USING (word_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM needles AS needle
        WHERE position(needle.term IN dictionary_search.text) = 0
          AND NOT coalesce(needle.term = ANY(form_matches.terms), false)
      )
    )`;
}

function counts(sql, all, useTotals, wordIds) {
  const matchingIds = wordIds ? sql`AND word_id = ANY(${wordIds}::text[])` : sql``;
  if (all && useTotals) return sql`
    SELECT word_id, occurrences AS count FROM yomiru_public_word_total
    WHERE (SELECT valid FROM selection) ${matchingIds}`;
  if (useTotals) return sql`
    SELECT o.word_id, sum(o.occurrences) AS count
    FROM selected JOIN yomiru_public_title_word AS o USING (video_id)
    WHERE (SELECT valid FROM selection) ${matchingIds} GROUP BY o.word_id`;
  return sql`
    SELECT word_id, sum((detail ->> 'count')::integer) AS count
    FROM (${occurrences(sql)}) AS occurrence WHERE true ${matchingIds} GROUP BY word_id`;
}

function practiceChecks(sql, checks, eligible = false) {
  return sql`coalesce((SELECT string_agg(CASE
      WHEN card.word_id IS NULL ${eligible ? sql`OR NOT (members.word_ids ? card.word_id)` : sql``} THEN '0'
      WHEN item->>1 = card.reading_key AND item->>2 = ANY(card.meaning_keys) THEN '2'
      ELSE '1' END, '' ORDER BY position)
    FROM jsonb_array_elements(${sql.json(checks)}::jsonb) WITH ORDINALITY AS requested(item, position)
    LEFT JOIN yomiru_public_practice_card AS card ON card.word_id = item->>0
    ${eligible ? sql`CROSS JOIN (SELECT coalesce(jsonb_object_agg(word_id, true), '{}'::jsonb) AS word_ids
      FROM eligible WHERE word_id IN (SELECT jsonb_array_elements_text(${sql.json(checks.map(([id]) => id))}::jsonb))
    ) AS members` : sql``}), '')`;
}

async function readPracticeMembership(sql, request) {
  const { checks } = request.practice;
  const [result] = await sql`
    WITH ${scope(sql, request)}
    ${request.episodes ? sql`, eligible AS MATERIALIZED (
      SELECT card.word_id FROM jsonb_array_elements(${sql.json(checks)}::jsonb) AS requested(item)
      JOIN yomiru_public_practice_card AS card ON card.word_id = item->>0
      WHERE EXISTS (SELECT 1 FROM yomiru_incremental_occurrence AS o JOIN selected USING (video_id)
        WHERE o.word_id = card.word_id)
    )` : sql``}
    SELECT revision, valid, CASE WHEN valid THEN ${practiceChecks(sql, checks, request.episodes)} END AS checked
    FROM selection`;
  return result;
}

function practiceCandidates(sql, request, packed) {
  // Large selections benefit from joining the aggregated keys in bulk. The
  // widened comparison keeps PostgreSQL from doing an index probe per word.
  if (request.episodes && packed) return sql`
    SELECT key.word_id, frequency.count, frequency.count * key.rank_weight AS rank
    FROM (
      SELECT (posting >> 32)::integer AS term_id, sum((posting & 2147483647)::integer) AS count
      FROM selected JOIN yomiru_practice_title_posting USING (video_id)
      CROSS JOIN LATERAL unnest(postings) AS terms(posting)
      WHERE (SELECT valid FROM selection)
      GROUP BY (posting >> 32)::integer
    ) AS frequency JOIN yomiru_practice_word_key AS key
      ON ${request.episodes.length >= 50
        ? sql`key.term_id::bigint = frequency.term_id::bigint` : sql`key.term_id = frequency.term_id`}
    WHERE key.rank_weight IS NOT NULL`;
  return sql`
    SELECT c.word_id, c.count, c.count * CASE WHEN card.lower_priority THEN 1 ELSE 4 END AS rank
    FROM (${counts(sql, !request.episodes, true)}) AS c JOIN yomiru_public_practice_card AS card USING (word_id)`;
}

async function readUnbandedPracticePage(sql, request, packed = true) {
  const { after, checks, review } = request.practice;
  const ordered = request.order === "subtitle";
  const revisions = ordered && practiceSourceRevisions(sql, request, true);
  const prompts = sql`
    SELECT word_id, cue_id, rank, yomiru_practice_key(card.meaning) AS gloss_key
    FROM eligible JOIN yomiru_public_practice_card AS card USING (word_id) WHERE rank IS NOT NULL`;
  const contextual = ordered && practiceContextEnabled();
  const timed = contextual && await hasPracticeSourceTimings(sql);
  const timeline = timed && !after && /^tt\d+:\d+:\d+$/.test(request.episodes[0].id)
    ? episodePracticeTimeline(sql, revisions, prompts) : null;
  const translations = contextual && await hasEpisodeTranslations(sql);
  const lines = translations && !after ? episodePracticeLines(sql, revisions, prompts, request) : sql`NULL::jsonb`;
  const renderedTrack = timed ? episodeRenderedTrack(sql, revisions, request) : sql`NULL::jsonb`;
  const renderedTimings = timed && !after ? episodeRenderedTimings(sql, revisions, prompts) : sql`NULL::jsonb`;
  const candidates = ordered ? sql`
    SELECT word_id, (detail ->> 'count')::int AS count, example->>'cue' AS cue_id,
      CASE WHEN example->>'cue' IS NOT NULL THEN row_number() OVER (ORDER BY
        (example->>'start')::int DESC NULLS FIRST, (example->>'cue') COLLATE "C" DESC NULLS FIRST,
        word_offset DESC NULLS FIRST, word_id COLLATE "C" DESC) END AS rank
    FROM (${occurrences(sql)}) AS occurrence JOIN yomiru_public_practice_card USING (word_id)
    CROSS JOIN LATERAL (SELECT detail #> '{examples,0}' AS example, nullif(detail #>> '{forms,0}', '') AS form) AS source
    CROSS JOIN LATERAL (SELECT coalesce((example->>'offset')::int,
      nullif(strpos(example->>'japanese', form), 0) - 1) AS word_offset) AS location`
    : practiceCandidates(sql, request, packed);
  const [result] = await sql`
    WITH ${scope(sql, request)}, eligible AS MATERIALIZED (${candidates}), batch AS (
      SELECT * FROM eligible WHERE rank IS NOT NULL
      ${after ? sql`AND (rank < ${after[0]}::bigint OR (rank = ${after[0]}::bigint
        AND word_id COLLATE "C" > ${after[1]}))` : sql``}
      ORDER BY rank DESC, word_id COLLATE "C" LIMIT ${practicePageSize + 1}
    ), review AS (
      SELECT e.* FROM jsonb_array_elements_text(${sql.json(review)}::jsonb) AS r(word_id)
      JOIN eligible AS e USING (word_id)
      WHERE rank IS NOT NULL AND NOT EXISTS (SELECT 1 FROM batch WHERE batch.word_id = e.word_id)
    ), context AS MATERIALIZED (
      SELECT *, CASE WHEN valid THEN ${lines} END AS lines,
        CASE WHEN valid THEN ${renderedTrack} END AS rendered_track
      FROM selection
    )
    SELECT revision, valid, lines,
      ${!after ? sql`CASE WHEN valid THEN (SELECT count(*)::int FROM eligible) END AS total,` : sql``}
      ${timeline ? sql`CASE WHEN valid THEN ${timeline} END AS timeline,` : sql``}
      CASE WHEN rendered_track IS NOT NULL AND lines IS NULL THEN ${renderedTimings} END AS rendered_timings,
      rendered_track,
      (rendered_track IS NOT NULL OR
        ${translations ? hasEpisodeTranslationChoice(sql, revisions, request) : sql`false`}) AS canonical_context,
      ${checks.length ? practiceChecks(sql, checks, true) : sql`''`} AS checked,
      ${practiceRows(sql,"batch",request,true)} AS batch, ${practiceRows(sql,"review",request)} AS reviews
    FROM context`;
  return finishPracticePage(result);
}

async function readGlobalPracticePage(sql, request) {
  const { after, checks, review } = request.practice;
  // Each priority uses the stored occurrence ordering. Merge their bounded
  // windows because multiplying counts would otherwise require a global sort.
  const window = weight => sql`
    SELECT total.word_id, occurrences AS count, occurrences * ${weight}::bigint AS rank
    FROM yomiru_public_word_total AS total
    CROSS JOIN LATERAL (
      SELECT lower_priority FROM yomiru_public_practice_card WHERE word_id=total.word_id OFFSET 0
    ) AS card
    WHERE (SELECT valid FROM selection) AND card.lower_priority=${weight === 1}
    ${after ? sql`AND occurrences<=${Math.floor(after[0] / weight)}::bigint
      AND (occurrences*${weight}::bigint<${after[0]}::bigint OR total.word_id COLLATE "C">${after[1]})` : sql``}
    ORDER BY occurrences DESC,total.word_id COLLATE "C" LIMIT ${practicePageSize + 1}`;
  const [result] = await sql`
    WITH ${scope(sql, request)}, batch AS MATERIALIZED (
      SELECT * FROM ((${window(4)}) UNION ALL (${window(1)})) AS candidates
      ORDER BY rank DESC,word_id COLLATE "C" LIMIT ${practicePageSize + 1}
    ), review AS (
      SELECT word_id, occurrences AS count,
        occurrences * CASE WHEN card.lower_priority THEN 1 ELSE 4 END AS rank
      FROM jsonb_array_elements_text(${sql.json(review)}::jsonb) AS requested(word_id)
      JOIN yomiru_public_word_total USING (word_id) JOIN yomiru_public_practice_card AS card USING (word_id)
      WHERE (SELECT valid FROM selection) AND NOT EXISTS (SELECT 1 FROM batch WHERE batch.word_id=requested.word_id)
    )
    SELECT revision, valid,
      ${!after ? sql`CASE WHEN valid THEN (SELECT count(*)::int FROM yomiru_public_practice_card) END AS total,` : sql``}
      ${checks.length ? sql`CASE WHEN valid THEN ${practiceChecks(sql, checks)} END` : sql`''`} AS checked,
      ${practiceRows(sql,"batch",request,true)} AS batch, ${practiceRows(sql,"review",request)} AS reviews
    FROM selection`;
  return finishPracticePage(result);
}

function practiceContextEnabled() {
  return (process.env.YOMIRU_PRACTICE_CONTEXT ?? (process.env.VERCEL_ENV === "production" ? "1" : "0")) === "1";
}

function practiceRows(sql, source, request, ranks = false) {
  // Keep hydration bounded to the page or review list, even when the planner
  // overestimates how many rows that list draws from the ranking.
  const episode = request.order === "subtitle";
  const examples = request.order !== "phrase" && practiceContextEnabled() ? sql`,${practiceExamples(sql,
    practiceSourceRevisions(sql, request, true), sql`e.word_id`, sql`yomiru_practice_key(card.meaning)`,
    episode ? sql`e.cue_id` : null, true, episode)}`
    : sql`,NULL`;
  return sql`coalesce((SELECT jsonb_agg(jsonb_build_array(e.word_id,card.kana,card.romaji,card.meaning,
    card.reading_key,yomiru_practice_key(card.meaning),card.meaning_keys,e.count,card.lower_priority,
    card.category ${examples}, card.written ${ranks ? sql`,e.rank` : sql``})
    ORDER BY e.rank DESC,e.word_id COLLATE "C")
    FROM ${sql(source)} AS e CROSS JOIN LATERAL (
      SELECT details.*,split_part(dictionary.detail->>'pos','/',1) AS category,
        dictionary.detail->>'word' AS written
      FROM yomiru_public_practice_card AS details
      LEFT JOIN yomiru_incremental_dictionary AS dictionary ON dictionary.id=details.word_id
      WHERE details.word_id=e.word_id OFFSET 0
    ) AS card),'[]'::jsonb)`;
}

const phraseAlternativesPerCategory = 12;

export async function readPhrasePracticePage(sql, request,
  readArchive = process.env.VERCEL_ENV === "production" ? readArchivedPhraseCues : null) {
  const { after, checks } = request.practice;
  const review = request.mode === "practice-review";
  const limit = review ? 1024 : practicePageSize;
  const contextual = review || practiceContextEnabled();
  const timed = contextual && await hasPracticeSourceTimings(sql);
  const translations = timed && await hasEpisodeTranslations(sql);
  const sourceWords = timed && await hasPracticeSourceWords(sql);
  const rank = contextual && readArchive ? after?.[0] ?? request.episodes.length : undefined;
  const archived = rank && await readArchive(sql, request, rank).catch(error => {
    if (error instanceof ReviewedPracticeUnavailable) throw error;
    reportServerError(error, "practice-phrase-archive");
    return null;
  });
  const prepared = Boolean(archived?.wordIds);
  if (request.requireReviewed && !prepared) {
    const [selection] = await sql`WITH ${scope(sql, request)} SELECT revision, valid FROM selection`;
    return selection && { ...selection, practiceUnsupported: true };
  }
  const preparedSelection = prepared && request.episodes.length === 1;
  const episodeAlternatives = prepared && !review;
  const includeFallback = episodeAlternatives && !after;
  const libraryAlternatives = sql`SELECT word_id, 1 AS count, 1 AS rank
    FROM yomiru_public_practice_card WHERE (SELECT valid FROM selection) ORDER BY word_id LIMIT 48`;
  const supplementalCards = archived?.supplementalCards ?? [];
  const supplemental = supplementalCards.length ? sql.json(Object.fromEntries(
    supplementalCards.map(([id, kana, , meaning, , , , , , pos, , written]) =>
      [id, [meaning, written, pos, kana]]))) : undefined;
  const [result] = await sql`
    WITH ${scope(sql, request)}, eligible AS MATERIALIZED (
      SELECT DISTINCT word_id FROM yomiru_incremental_occurrence JOIN selected USING (video_id)
      JOIN yomiru_public_practice_card USING (word_id) WHERE (SELECT valid FROM selection)
      ${preparedSelection ? sql`AND word_id = ANY(${sql.array(archived.wordIds, 25)})` : sql``}
      ${preparedSelection && supplementalCards.length ? sql`
        UNION SELECT unnest(${sql.array(supplementalCards.map(([id]) => id), 25)})
          WHERE (SELECT valid FROM selection)` : sql``}
    ), batch AS MATERIALIZED (
      ${contextual ? practicePhraseBatch(sql, request, { rank, archived, limit }) : sql`
        SELECT NULL::bigint AS rank, NULL::text AS video_id, NULL::text AS source_revision,
          NULL::text AS cue_id, NULL::jsonb AS targets WHERE false`}
    ), targets AS (
      SELECT DISTINCT target->>0 AS word_id
      FROM batch CROSS JOIN LATERAL jsonb_array_elements(batch.targets) AS token(target)
    ), options AS (
      SELECT word_id, 1 AS count, 1 AS rank FROM targets
      ${episodeAlternatives ? sql`
      UNION
      SELECT word_id, 1 AS count, 1 AS rank FROM (
        SELECT card.word_id, row_number() OVER (
          PARTITION BY split_part(dictionary.detail->>'pos', '/', 1)
          ORDER BY card.word_id COLLATE "C"
        ) AS position
        FROM unnest(${sql.array(archived.wordIds, 25)}) AS episode(word_id)
        JOIN yomiru_public_practice_card AS card USING (word_id)
        JOIN yomiru_incremental_dictionary AS dictionary ON dictionary.id = card.word_id
        WHERE (SELECT valid FROM selection) AND NOT EXISTS (SELECT 1 FROM targets WHERE word_id = card.word_id)
      ) AS alternatives WHERE position <= ${phraseAlternativesPerCategory}`
        : prepared ? sql`` : sql`UNION SELECT * FROM (${libraryAlternatives}) AS alternatives`}
    )
    ${includeFallback ? sql`, fallback AS (${libraryAlternatives})` : sql``}
    SELECT revision, valid,
      ${!after ? sql`(SELECT count(*)::int FROM eligible) AS total,` : sql``}
      ${preparedSelection && !after ? sql`(SELECT array_agg(word_id) FROM eligible) AS "playableIds",` : sql``}
      ${checks.length ? practiceChecks(sql, checks, true) : sql`''`} AS checked,
      ${contextual ? practicePhraseDetails(sql, request, {
        translations, timed, sourceWords, prepared, lookups: !review, supplemental,
      }) : sql`'[]'::jsonb`} AS phrases,
      ${practiceRows(sql, "options", request)} AS cards
      ${includeFallback ? sql`, ${practiceRows(sql, "fallback", request)} AS "fallbackCards"` : sql``}
    FROM selection`;
  if (!result?.valid) return result;
  const page = finishPhrasePage(result, rank, limit);
  if (supplementalCards.length) {
    const hydrated = new Set(page.cards.map(([id]) => id));
    const targets = new Set(page.phrases.flatMap(phrase => phrase.targets.map(([id]) => id)));
    const missing = supplementalCards.filter(([id]) => !hydrated.has(id));
    page.cards.push(...missing.filter(([id]) => targets.has(id)));
    if (episodeAlternatives) page.cards.push(...missing.filter(([id]) => !targets.has(id)).slice(0, 48));
    if (preparedSelection && !after) page.supplementalCards = supplementalCards;
  }
  return page;
}

export async function readPracticeReview(sql, request, readArchive = readArchivedPhraseCues,
  bundled = bundledReviewedSources) {
  const [previous = "", cue] = request.cursor?.split("/") ?? [];
  const stored = await hasStoredPracticeReviews(sql);
  const [selection] = await sql`
    WITH ${scope(sql, request)}
    SELECT revision, valid, ARRAY(
      SELECT video_id
      FROM (${reviewedPracticeTitles(sql, stored, bundled)}) AS reviewed
      WHERE selection.valid
        AND video_id COLLATE "C" ${cue ? sql`>=` : sql`>`} ${previous}
      ORDER BY video_id COLLATE "C" LIMIT 2
    ) AS titles FROM selection`;
  if (!selection?.valid) return { valid: false };
  const { revision, valid, titles: [id, following] } = selection;
  const result = { revision, valid, sources: [], next: following ? id : null };
  if (!id) return result;
  const after = id === previous && cue ? [1, cue] : null;
  const selected = { ...request, scope: "titles", episodes: [{ id }], order: "phrase", practice: { after, checks: [] } };
  const archive = await readArchive(sql, selected, 1);
  if (!archive?.wordIds) return result;
  const page = await readPhrasePracticePage(sql, selected, async () => archive);
  if (!page?.valid) return { valid: false };
  const phrases = page.phrases.map(({ cue, kana, romaji, targets, japanese, japaneseTargets }) =>
    ({ cue, kana, romaji, targets, japanese, japaneseTargets }));
  result.sources.push({ id, cards: page.cards, phrases });
  if (page.next) result.next = `${id}/${page.next[1]}`;
  return result;
}

function finishPracticePage(result) {
  if (!result?.valid) return result;
  const cards = result.batch.slice(0, practicePageSize);
  const last = cards.at(-1);
  const next = result.batch.length > practicePageSize ? [last.at(-1), last[0]] : null;
  const continuation = next && result.signature
    ? Buffer.from(JSON.stringify([result.signature, result.ahead, result.reusable])).toString("base64url") : undefined;
  return { revision: result.revision, valid: true, total: result.total, checked: result.checked,
    cards: cards.map(row => row.slice(0, -1)), reviews: result.reviews, next,
    ...(result.timeline?.stops?.length && { timeline: result.timeline }),
    ...(result.lines && { lines: result.lines }),
    ...(result.canonical_context && { canonicalContext: true }),
    ...(result.rendered_timings && { renderedPractice: { track: result.rendered_track, timings: result.rendered_timings } }),
    ...(continuation && { continuation }) };
}

function practiceBandFrequencies(sql) {
  // The migration packs 32 counters into eight decimal digits each. Sparse
  // postings include counts too large for a lane and titles with no dense band.
  return sql`
    title_packs AS MATERIALIZED (
      SELECT band.* FROM selected JOIN yomiru_practice_title_band AS band USING (video_id)
      WHERE (SELECT valid FROM selection)
    ), sums AS MATERIALIZED (
      SELECT band, convert_to(lpad(sum(value)::text,256,'0'),'UTF8') AS digits FROM (
        SELECT unnest(bands) AS band, unnest(values) AS value FROM title_packs
      ) AS packs GROUP BY band
    ), dense AS NOT MATERIALIZED (
      SELECT term_id, count, weight FROM (
        SELECT lane.term_id,lane.weight,
          convert_from(substring(s.digits FROM (lane.slot::int-1)*8+1 FOR 8),'UTF8')::integer AS count
        FROM sums AS s JOIN yomiru_practice_band AS b USING (band)
        CROSS JOIN LATERAL unnest(b.ids,b.weights) WITH ORDINALITY AS lane(term_id,weight,slot)
      ) AS decoded WHERE weight IS NOT NULL AND count>0
    ), sparse_counts AS MATERIALIZED (
      SELECT (posting >> 32)::integer AS term_id,sum((posting & 2147483647)::integer) AS count
      FROM (
        SELECT unnest(sparse) AS posting FROM title_packs WHERE cardinality(sparse)>0
        UNION ALL
        SELECT unnest(postings) FROM selected JOIN yomiru_practice_title_posting USING (video_id)
        WHERE (SELECT valid FROM selection) AND NOT EXISTS
          (SELECT 1 FROM title_packs WHERE title_packs.video_id=selected.video_id)
      ) AS postings GROUP BY (posting >> 32)::integer
    ), sparse AS (
      SELECT f.term_id,f.count,key.rank_weight AS weight
      FROM sparse_counts AS f JOIN yomiru_practice_word_key AS key ON key.term_id::bigint=f.term_id::bigint
      WHERE key.rank_weight IS NOT NULL
    ), frequency AS MATERIALIZED (
      SELECT term_id,count::bigint,count::bigint*weight AS rank FROM dense WHERE NOT EXISTS (SELECT 1 FROM sparse_counts)
      UNION ALL
      SELECT term_id,coalesce(dense.count,0)+coalesce(sparse.count,0) AS count,
        (coalesce(dense.count,0)+coalesce(sparse.count,0))*coalesce(dense.weight,sparse.weight) AS rank
      FROM dense FULL JOIN sparse USING (term_id) WHERE EXISTS (SELECT 1 FROM sparse_counts)
    )`;
}

function practiceScopeDigest(request) {
  const episodes = request.episodes.map(row => row.id).sort();
  return createHash("sha256").update(JSON.stringify([practiceEligibility, episodes])).digest("hex");
}

async function readBandedPracticePage(sql, request, digest) {
  const { after, checks, review } = request.practice;
  const [result] = await sql`
    WITH ${scope(sql,request)}, ${practiceBandFrequencies(sql)}, top_rank AS (
      SELECT f.* FROM frequency AS f
      ${after ? sql`WHERE f.rank<${after[0]}::bigint OR (f.rank=${after[0]}::bigint AND EXISTS
        (SELECT 1 FROM yomiru_practice_word_key WHERE term_id=f.term_id AND word_id COLLATE "C">${after[1]}))` : sql``}
      ORDER BY f.rank DESC FETCH FIRST ${2*practicePageSize+1} ROWS WITH TIES
    ), ranked_window AS MATERIALIZED (
      SELECT f.*,key.word_id FROM top_rank AS f JOIN yomiru_practice_word_key AS key USING (term_id)
      ORDER BY f.rank DESC,key.word_id COLLATE "C" LIMIT ${2*practicePageSize+1}
    ), batch AS MATERIALIZED (
      SELECT * FROM ranked_window ORDER BY rank DESC,word_id COLLATE "C" LIMIT ${practicePageSize+1}
    ), requested_reviews AS MATERIALIZED (
      SELECT key.term_id,key.word_id FROM jsonb_array_elements_text(${sql.json(review)}::jsonb) AS requested(word_id)
      JOIN yomiru_practice_word_key AS key USING (word_id)
    ), review AS MATERIALIZED (
      SELECT f.*,requested.word_id FROM frequency AS f JOIN requested_reviews AS requested USING (term_id)
      WHERE NOT EXISTS (SELECT 1 FROM batch WHERE batch.term_id=f.term_id)
    ), requested_checks AS MATERIALIZED (
      SELECT item,position,key.term_id,key.word_id
      FROM jsonb_array_elements(${sql.json(checks)}::jsonb) WITH ORDINALITY AS requested(item,position)
      LEFT JOIN yomiru_practice_word_key AS key ON key.word_id=item->>0
    ), ahead_rows AS MATERIALIZED (
      SELECT * FROM ranked_window ORDER BY rank DESC,word_id COLLATE "C" OFFSET ${practicePageSize}
    ), ahead AS (
      SELECT jsonb_agg(jsonb_build_array(term_id,count,rank) ORDER BY rank DESC,word_id COLLATE "C") AS rows
      FROM ahead_rows
    ), reusable AS MATERIALIZED (
      SELECT coalesce(jsonb_agg(jsonb_build_array(term_id,count,rank) ORDER BY term_id),'[]'::jsonb) AS rows
      FROM (SELECT * FROM batch UNION ALL SELECT * FROM review) AS loaded
      WHERE NOT EXISTS (SELECT 1 FROM ahead_rows WHERE ahead_rows.term_id=loaded.term_id)
    )
    SELECT revision,valid, ${!after ? sql`CASE WHEN valid THEN (SELECT count(*)::int FROM frequency) END AS total,` : sql``}
      ${checks.length ? sql`coalesce((SELECT string_agg(CASE WHEN active.term_id IS NULL OR card.word_id IS NULL THEN '0'
        WHEN item->>1=card.reading_key AND item->>2=ANY(card.meaning_keys) THEN '2' ELSE '1' END,'' ORDER BY position)
        FROM requested_checks LEFT JOIN (SELECT term_id FROM frequency
          WHERE term_id IN (SELECT term_id FROM requested_checks)) AS active USING (term_id)
        LEFT JOIN yomiru_public_practice_card AS card ON card.word_id=requested_checks.word_id),'')` : sql`''`} AS checked,
      ${practiceRows(sql,"batch",request,true)} AS batch, ${practiceRows(sql,"review",request)} AS reviews,
      (SELECT rows FROM ahead) AS ahead, (SELECT rows FROM reusable) AS reusable,
      (SELECT yomiru_practice_cursor_signature(jsonb_build_array(selection.revision,${digest}::text,
        (SELECT jsonb_build_array(rank,word_id) FROM batch ORDER BY rank DESC,word_id COLLATE "C" OFFSET ${practicePageSize-1} LIMIT 1),
        rows,(SELECT rows FROM reusable)))
        FROM ahead WHERE rows IS NOT NULL) AS signature
    FROM selection`;
  return finishPracticePage(result);
}

function decodePracticeContinuation(token) {
  if (typeof token !== "string" || token.length > 9000 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const [signature, rows, reusable] = JSON.parse(Buffer.from(token,"base64url").toString());
    if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)
      || !Array.isArray(rows) || !rows.length || rows.length > practicePageSize+1
      || !Array.isArray(reusable) || reusable.length > practicePageSize+1+practiceReviewSize
      || ![...rows,...reusable].every(row => Array.isArray(row) && row.length === 3 && row[0] <= 2147483647
        && row.every(n => Number.isSafeInteger(n) && n > 0))) return null;
    return { signature, rows, reusable };
  } catch { return null; }
}

async function readSignedPracticeRefill(sql, request, digest, cursor) {
  const { after,review } = request.practice;
  // The signature binds the previously validated selection to the active
  // publication. Reviews missing from that window still need exact counts.
  const [result] = await sql`
    WITH payload AS MATERIALIZED (
      SELECT ${sql.json(cursor.rows)}::jsonb AS ahead,${sql.json(cursor.reusable)}::jsonb AS reusable
    ), verified AS MATERIALIZED (
      SELECT revision,revision=${request.publication} AS valid,
        revision=${request.publication} AND (yomiru_practice_cursor_signature(jsonb_build_array(revision,${digest}::text,
        ${sql.json(after)}::jsonb,ahead,reusable)) = ${cursor.signature}) IS TRUE AS authorized
      FROM yomiru_incremental_head CROSS JOIN payload WHERE singleton AND serving
    ), known AS MATERIALIZED (
      SELECT key.word_id,(item->>1)::bigint AS count,(item->>2)::bigint AS rank,next_page
      FROM (SELECT jsonb_array_elements(ahead) AS item,true AS next_page FROM payload
        UNION ALL SELECT jsonb_array_elements(reusable),false FROM payload) AS data
      JOIN yomiru_practice_word_key AS key ON key.term_id=(item->>0)::integer
      WHERE (SELECT authorized FROM verified)
    ), batch AS (SELECT * FROM known WHERE next_page), review AS (
      SELECT requested.word_id,frequency.count,frequency.count * CASE WHEN card.lower_priority THEN 1 ELSE 4 END AS rank
      FROM jsonb_array_elements_text(${sql.json(review)}::jsonb) AS requested(word_id)
      JOIN yomiru_public_practice_card AS card USING (word_id)
      LEFT JOIN known USING (word_id)
      CROSS JOIN LATERAL (SELECT coalesce(known.count,(SELECT sum(o.occurrences)
        FROM yomiru_public_title_word AS o WHERE o.word_id=requested.word_id
        AND o.video_id=ANY(ARRAY(SELECT jsonb_array_elements_text(${sql.json(request.episodes.map(row => row.id))}::jsonb)))
        AND (SELECT authorized FROM verified))) AS count) AS frequency
      WHERE frequency.count>0 AND known.next_page IS DISTINCT FROM true
    )
    SELECT revision,valid,authorized,'' AS checked,
      ${practiceRows(sql,"batch",request,true)} AS batch, ${practiceRows(sql,"review",request)} AS reviews FROM verified`;
  if (result?.valid && !result.authorized) return undefined;
  return finishPracticePage(result);
}

export async function readPracticePage(sql, request, packed = true) {
  if (request.order === "phrase") return readPhrasePracticePage(sql, request);
  if (request.order === "subtitle") return readUnbandedPracticePage(sql, request);
  if (!request.episodes) return readGlobalPracticePage(sql, request);
  const large = packed && request.scope === "titles" && request.episodes?.length >= 32 && request.episodes.length <= 10000;
  if (large) {
    const digest = practiceScopeDigest(request);
    const { after,checks,continuation } = request.practice;
    const cursor = after && !checks.length && continuation && decodePracticeContinuation(continuation);
    try {
      if (cursor) {
        const refill = await readSignedPracticeRefill(sql,request,digest,cursor);
        if (refill) return refill;
      }
      return await readBandedPracticePage(sql,request,digest);
    } catch (error) {
      if (!["42P01","42883"].includes(error.code) || !/yomiru_practice_(band|title_band|cursor)/.test(error.message)) throw error;
    }
  }
  return readUnbandedPracticePage(sql,request,packed);
}

export function pageVocabulary(words, { query = "", category = "", offset = 0, index, wordIds }, sort) {
  if (wordIds) {
    const requested = new Set(wordIds);
    return { words: words.filter(word => requested.has(word.id)), nextOffset: null };
  }
  const ordered = sort ? sortVocabularyByColumn(words, sort) : words;
  const matches = filterVocabulary(ordered, query, category);
  const end = offset + (index ? vocabularyIndexPageSize : vocabularyPageSize);
  const slice = matches.slice(offset, end);
  return { ...(index ? { index: slice.map(word => [word.id, isPracticePartOfSpeech(word.pos)]) } : { words: slice }),
    nextOffset: end < matches.length ? end : null };
}

function publicWord(sql, forms) {
  return sql`jsonb_build_object(
    'id', words.word_id,
    'word', dictionary.detail ->> 'word',
    'reading', dictionary.detail ->> 'reading',
    'romaji', dictionary.detail ->> 'romaji',
    'pos', dictionary.detail ->> 'pos',
    'meanings', coalesce(dictionary.detail #> '{meanings,eng}', '[]'::jsonb),
    'count', words.count,
    'aliases', coalesce(dictionary.detail -> 'aliases', '[]'::jsonb),
    'forms', ${forms ? sql`words.forms` : sql`'[]'::jsonb`},
    'formReadings', ${forms ? sql`words.readings` : sql`'[]'::jsonb`}
  )`;
}

const practiceRow = sql => sql`jsonb_build_array(
  words.word_id, dictionary.detail ->> 'word', dictionary.detail ->> 'reading',
  dictionary.detail ->> 'romaji', dictionary.detail ->> 'pos', dictionary.detail #> '{meanings,eng}', words.count
)`;

export async function readVocabularySummary(sql, request, useTotals = false) {
  const saved = useTotals && !request.episodes;
  const [row] = await sql`
    WITH ${scope(sql, request)}
    SELECT revision, valid, data.*
    FROM selection LEFT JOIN LATERAL (
      ${saved ? sql`
        SELECT total, english, episode_count, movie_count FROM yomiru_public_vocabulary_summary WHERE singleton
      ` : sql`
        SELECT count(*)::int AS total,
          count(*) FILTER (WHERE jsonb_array_length(dictionary.detail #> '{meanings,eng}') > 0)::int AS english,
          (SELECT count(*)::int FROM selected) AS episode_count,
          (SELECT count(*)::int FROM selected WHERE video_id ~ '^tt[0-9]+$') AS movie_count
        FROM (SELECT DISTINCT word_id FROM ${useTotals ? sql`
          selected JOIN yomiru_public_title_word USING (video_id) WHERE selection.valid
        ` : sql`(${occurrences(sql)}) AS occurrence`}) AS words
        JOIN yomiru_incremental_dictionary AS dictionary ON dictionary.id = words.word_id
      `}
    ) AS data ON selection.valid`;
  if (!row || !row.valid) return row;
  if (row.total == null) throw new Error("Published vocabulary summary has not been initialized");
  const covered = row.english ? { eng: row.english } : {};
  return { revision: row.revision, valid: true, total: row.total, covered,
    ...(request.scope === "all" && { publication: row.revision, episodeCount: row.episode_count,
      ...(row.movie_count && { movieCount: row.movie_count }) }) };
}

export async function readVocabularyWords(sql, request, useTotals = false) {
  const { page, sort } = request;
  const terms = page ? vocabularySearchTerms(page.query) : [];
  const searching = terms.length > 0;
  const directPage = page && !searching;
  const indexOnly = page?.index && !searching;
  const paginating = directPage && !page?.index && !page?.wordIds;
  const includeForms = request.mode === "study" || searching || page?.history;
  const byCategory = sql`coalesce(${sql.json(vocabularyCategoryMap)}::jsonb
    ->> split_part(dictionary.detail ->> 'pos', '/', 1), 'Other')`;
  const byFrequency = sql`words.count DESC, (dictionary.detail ->> 'reading') COLLATE "ja-x-icu",
    (dictionary.detail ->> 'word') COLLATE "ja-x-icu", words.word_id`;
  const direction = sort?.direction === "ascending" ? sql`ASC` : sql`DESC`;
  const projectedSort = useTotals && directPage && ["meaning", "otherMeanings"].includes(sort?.column);
  const sortKey = sort && {
    frequency: sql`words.count`,
    japanese: sql`coalesce(nullif(dictionary.detail ->> 'reading', ''), dictionary.detail ->> 'word') COLLATE "ja-x-icu"`,
    category: byCategory,
    meaning: projectedSort ? sql`lexeme.first_meaning COLLATE "en-x-icu"` : englishSortKey(sql, 0),
    otherMeanings: projectedSort ? sql`lexeme.second_meaning COLLATE "en-x-icu"` : englishSortKey(sql, 1),
  }[sort.column];
  const order = directPage && sortKey ? sql`${sortKey} ${direction} NULLS LAST, ${byFrequency}` : byFrequency;
  // The frequency index locates the boundary before loading any dictionary
  // fields. Include ties so Japanese reading order remains correct.
  const useFrequencyBoundary = paginating && !page.category && (!sort || sort.column === "frequency");
  const word = request.mode === "practice" ? practiceRow(sql) : indexOnly ? sql`
    jsonb_build_array(words.word_id, split_part(dictionary.detail ->> 'pos', '/', 1) IS DISTINCT FROM '助詞')
  ` : publicWord(sql, includeForms);
  const [result] = await sql`
    WITH ${scope(sql, request)},
    counts AS (${counts(sql, !request.episodes, useTotals, page?.wordIds)})
    ${searching ? sql`, ${searchCandidates(sql, terms, byCategory, page.category, useTotals)}` : sql``}
    ${useFrequencyBoundary ? sql`, candidates AS (
      SELECT * FROM counts ORDER BY count ${direction}
      FETCH FIRST ${page.offset + vocabularyPageSize + 1} ROWS WITH TIES
    )` : sql``}
    ${includeForms ? sql`, forms AS (
      SELECT form.word_id,
        coalesce(jsonb_agg(DISTINCT form.value) FILTER (WHERE form.kind = 'forms'), '[]'::jsonb) AS forms,
        coalesce(jsonb_agg(DISTINCT form.value) FILTER (WHERE form.kind = 'formReadings'), '[]'::jsonb) AS readings
      FROM ${searching ? sql`candidate_forms AS form JOIN matching USING (word_id)` : sql`(
        SELECT occurrence.word_id, value.kind, value.value
        FROM (${occurrences(sql)}) AS occurrence
        ${page?.history ? sql`JOIN counts USING (word_id)` : sql``}
        CROSS JOIN LATERAL (${sourceForms(sql)}) AS value
      ) AS form`}
      GROUP BY form.word_id
    )` : sql``}
    SELECT revision, valid,
      coalesce((SELECT jsonb_agg(word) FROM (
        SELECT ${word} AS word
        FROM ${includeForms ? sql`(
          SELECT candidates.*, coalesce(forms.forms, '[]'::jsonb) AS forms,
            coalesce(forms.readings, '[]'::jsonb) AS readings
          FROM ${searching ? sql`matching` : sql`counts`} AS candidates LEFT JOIN forms USING (word_id)
        )` : useFrequencyBoundary ? sql`candidates` : sql`counts`} AS words
        JOIN yomiru_incremental_dictionary AS dictionary ON dictionary.id = words.word_id
        ${projectedSort ? sql`JOIN yomiru_public_lexeme AS lexeme USING (word_id)` : sql``}
        ${page?.category ? sql`WHERE ${byCategory} = ${page.category}` : sql``}
        ${request.mode === "practice" ? sql`WHERE jsonb_array_length(dictionary.detail #> '{meanings,eng}') > 0
          AND split_part(dictionary.detail ->> 'pos', '/', 1) IS DISTINCT FROM '助詞'
          AND btrim(dictionary.detail ->> 'romaji') <> ''` : sql``}
        ORDER BY ${order}
        ${paginating || indexOnly ? sql`
          LIMIT ${(indexOnly ? vocabularyIndexPageSize : vocabularyPageSize) + 1} OFFSET ${page.offset}
        ` : sql``}
      ) AS page), '[]'::jsonb) AS words
    FROM selection`;
  if (!result || !result.valid) return result;
  if (request.mode === "practice") return result;
  if (!page) return { ...result, words: sortVocabulary(result.words) };
  if (indexOnly) return { revision: result.revision, valid: true, index: result.words.slice(0, vocabularyIndexPageSize),
    nextOffset: result.words.length > vocabularyIndexPageSize ? page.offset + vocabularyIndexPageSize : null };
  if (page.wordIds) return { ...result, nextOffset: null };
  if (paginating) return { ...result, words: result.words.slice(0, vocabularyPageSize),
    nextOffset: result.words.length > vocabularyPageSize ? page.offset + vocabularyPageSize : null };
  return { revision: result.revision, valid: true, ...pageVocabulary(sortVocabulary(result.words), page, sort) };
}

function englishSortKey(sql, offset) {
  return sql`translate(normalize(lower((
    SELECT gloss FROM jsonb_array_elements_text(dictionary.detail #> '{meanings,eng}') WITH ORDINALITY AS item(gloss, n)
    WHERE btrim(gloss) <> '' ORDER BY n LIMIT 1 OFFSET ${offset}
  ) COLLATE "en-x-icu"), NFD), ${removedMarks}, '') COLLATE "en-x-icu"`;
}

async function readPracticeTranslation(sql, request) {
  const revisions = practiceSourceRevisions(sql, request, true);
  const contextual = practiceContextEnabled();
  const translation = contextual && await hasEpisodeTranslations(sql)
    ? episodePracticeTranslation(sql, revisions, request) : sql`NULL::text`;
  const timed = contextual && await hasPracticeSourceTimings(sql);
  const [result] = await sql`
    WITH ${scope(sql, request)}, context AS MATERIALIZED (
      SELECT *, CASE WHEN valid THEN ${translation} END AS translation FROM selection
    )
    SELECT revision, valid, translation
      ${timed ? sql`, CASE WHEN valid AND translation IS NULL THEN ${episodeRenderedTrack(sql, revisions, request)}
        END AS rendered_track,
      CASE WHEN valid AND translation IS NULL THEN ${episodeRenderedTimings(sql, revisions, null, request.cue)}
        END AS rendered_timing` : sql``}
    FROM context`;
  if (!result) return result;
  const { rendered_track, rendered_timing, ...response } = result;
  if (rendered_track && rendered_timing) response.renderedPractice = { track: rendered_track, timings: rendered_timing };
  return response;
}

let totalsRetryAt = 0;

export async function readPostgresVocabulary(sql, request) {
  if (request.mode === "practice-review") return readPracticeReview(sql, request);
  if (["conjugation", "conjugation-review"].includes(request.mode)) {
    try { return await readConjugationDeck(sql, request); }
    catch (error) {
      if (error.code === "42P01" && /yomiru_incremental_/.test(error.message)) return undefined;
      throw error;
    }
  }
  if (["practice-page", "practice-membership", "practice-translation"].includes(request.mode)) {
    const read = { "practice-page": readPracticePage, "practice-membership": readPracticeMembership,
      "practice-translation": readPracticeTranslation }[request.mode];
    try { return await read(sql, request); }
    catch (error) {
      if (error.code === "42P01" && /yomiru_practice_(title_posting|word_key)/.test(error.message)) {
        return readPracticePage(sql, request, false);
      }
      if (error.code === "42P01" && error.message.includes("yomiru_incremental_")) return undefined;
      throw error;
    }
  }
  const read = { summary: readVocabularySummary, csv: readVocabularyExport }[request.mode] ?? readVocabularyWords;
  const totals = request.mode !== "csv" && Date.now() >= totalsRetryAt;
  try {
    return await read(sql, request, totals);
  } catch (error) {
    if (error.code !== "42P01") throw error;
    if (totals && /yomiru_public_(title_word|title_forms|word_total|vocabulary_summary|lexeme)/.test(error.message)) {
      // Accept requests from a worker started before the additive migration.
      totalsRetryAt = Date.now() + 30_000;
      return read(sql, request);
    }
    if (/yomiru_incremental_/.test(error.message)) return undefined;
    throw error;
  }
}
