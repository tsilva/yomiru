import {
  filterVocabulary, sortVocabulary, sortVocabularyByColumn, vocabularyCategoryMap, vocabularySearchTerms,
} from "../src/vocabulary-study.mjs";
import { sequenceMovies } from "./browse.mjs";
import { practicePageSize } from "../src/practice-deck.mjs";

export const vocabularyPageSize = 40;
const removedMarks = Array.from({ length: 0x70 }, (_, index) => String.fromCodePoint(0x300 + index)).join("");
const kana = start => Array.from({ length: 86 }, (_, index) => String.fromCodePoint(start + index)).join("");
const katakana = kana(0x30a1), hiragana = kana(0x3041);

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

function counts(sql, all, useTotals) {
  if (all && useTotals) return sql`
    SELECT word_id, occurrences AS count FROM yomiru_public_word_total
    WHERE (SELECT valid FROM selection)`;
  if (useTotals) return sql`
    SELECT o.word_id, sum(o.occurrences) AS count
    FROM selected JOIN yomiru_public_title_word AS o USING (video_id)
    WHERE (SELECT valid FROM selection) GROUP BY o.word_id`;
  return sql`
    SELECT word_id, sum((detail ->> 'count')::integer) AS count
    FROM (${occurrences(sql)}) AS occurrence GROUP BY word_id`;
}

function practiceChecks(sql, checks, eligible) {
  return sql`coalesce((SELECT string_agg(CASE
      WHEN card.word_id IS NULL ${eligible ? sql`OR e.word_id IS NULL` : sql``} THEN '0'
      WHEN item->>1 = card.reading_key AND item->>2 = ANY(card.meaning_keys) THEN '2'
      ELSE '1' END, '' ORDER BY position)
    FROM jsonb_array_elements(${sql.json(checks)}::jsonb) WITH ORDINALITY AS requested(item, position)
    LEFT JOIN yomiru_public_practice_card AS card ON card.word_id = item->>0
    ${eligible ? sql`LEFT JOIN eligible AS e ON e.word_id = card.word_id` : sql``}), '')`;
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

export async function readPracticePage(sql, request) {
  const { after, checks, review } = request.practice;
  const [result] = await sql`
    WITH ${scope(sql, request)}, eligible AS MATERIALIZED (
      SELECT c.word_id, c.count, c.count * CASE WHEN card.lower_priority THEN 1 ELSE 4 END AS rank
      FROM (${counts(sql, !request.episodes, true)}) AS c JOIN yomiru_public_practice_card AS card USING (word_id)
    ), batch AS (
      SELECT * FROM eligible
      ${after ? sql`WHERE rank < ${after[0]}::bigint OR (rank = ${after[0]}::bigint
        AND word_id COLLATE "C" > ${after[1]})` : sql``}
      ORDER BY rank DESC, word_id COLLATE "C" LIMIT ${practicePageSize + 1}
    ), review AS (
      SELECT e.* FROM jsonb_array_elements_text(${sql.json(review)}::jsonb) AS r(word_id)
      JOIN eligible AS e USING (word_id)
      WHERE NOT EXISTS (SELECT 1 FROM batch WHERE batch.word_id = e.word_id)
    )
    SELECT revision, valid,
      ${!after ? sql`CASE WHEN valid THEN (SELECT count(*)::int FROM eligible) END AS total,` : sql``}
      ${checks.length ? practiceChecks(sql, checks, true) : sql`''`} AS checked,
      coalesce((SELECT jsonb_agg(jsonb_build_array(e.word_id, card.kana, card.romaji, card.meaning,
        card.reading_key, yomiru_practice_key(card.meaning), card.meaning_keys, e.count, card.lower_priority,
        split_part(dictionary.detail ->> 'pos', '/', 1), e.rank)
        ORDER BY e.rank DESC, e.word_id COLLATE "C")
        FROM batch AS e JOIN yomiru_public_practice_card AS card USING (word_id)
        LEFT JOIN yomiru_incremental_dictionary AS dictionary ON dictionary.id = e.word_id), '[]') AS batch,
      coalesce((SELECT jsonb_agg(jsonb_build_array(e.word_id, card.kana, card.romaji, card.meaning,
        card.reading_key, yomiru_practice_key(card.meaning), card.meaning_keys, e.count, card.lower_priority,
        split_part(dictionary.detail ->> 'pos', '/', 1))
        ORDER BY e.rank DESC, e.word_id COLLATE "C")
        FROM review AS e JOIN yomiru_public_practice_card AS card USING (word_id)
        LEFT JOIN yomiru_incremental_dictionary AS dictionary ON dictionary.id = e.word_id), '[]') AS reviews
    FROM selection`;
  if (!result?.valid) return result;
  const cards = result.batch.slice(0, practicePageSize);
  const last = cards.at(-1);
  const next = result.batch.length > practicePageSize ? [last.at(-1), last[0]] : null;
  return { revision: result.revision, valid: true, total: result.total, checked: result.checked,
    cards: cards.map(row => row.slice(0, -1)), reviews: result.reviews, next };
}

export function pageVocabulary(words, { query = "", category = "", offset = 0 }, sort) {
  const ordered = sort ? sortVocabularyByColumn(words, sort) : words;
  const matches = filterVocabulary(ordered, query, category);
  const end = offset + vocabularyPageSize;
  return { words: matches.slice(offset, end), nextOffset: end < matches.length ? end : null };
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
  const includeForms = request.mode === "study" || searching;
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
  const useFrequencyBoundary = directPage && !page.category && (!sort || sort.column === "frequency");
  const [result] = await sql`
    WITH ${scope(sql, request)},
    counts AS (${counts(sql, !request.episodes, useTotals)})
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
        FROM (${occurrences(sql)}) AS occurrence CROSS JOIN LATERAL (${sourceForms(sql)}) AS value
      ) AS form`}
      GROUP BY form.word_id
    )` : sql``}
    SELECT revision, valid,
      coalesce((SELECT jsonb_agg(word) FROM (
        SELECT ${request.mode === "practice" ? practiceRow(sql) : publicWord(sql, includeForms)} AS word
        FROM ${includeForms ? sql`(
          SELECT candidates.*, coalesce(forms.forms, '[]'::jsonb) AS forms,
            coalesce(forms.readings, '[]'::jsonb) AS readings
          FROM ${searching ? sql`matching` : sql`counts`} AS candidates LEFT JOIN forms USING (word_id)
        )` : useFrequencyBoundary ? sql`candidates` : sql`counts`} AS words
        JOIN yomiru_incremental_dictionary AS dictionary ON dictionary.id = words.word_id
        ${projectedSort ? sql`JOIN yomiru_public_lexeme AS lexeme USING (word_id)` : sql``}
        ${page?.category ? sql`WHERE ${byCategory} = ${page.category}` : sql``}
        ${request.mode === "practice" ? sql`WHERE jsonb_array_length(dictionary.detail #> '{meanings,eng}') > 0
          AND btrim(dictionary.detail ->> 'romaji') <> ''` : sql``}
        ORDER BY ${order}
        ${directPage ? sql`LIMIT ${vocabularyPageSize + 1} OFFSET ${page.offset}` : sql``}
      ) AS page), '[]'::jsonb) AS words
    FROM selection`;
  if (!result || !result.valid) return result;
  if (request.mode === "practice") return result;
  if (!page) return { ...result, words: sortVocabulary(result.words) };
  if (directPage) return { ...result, words: result.words.slice(0, vocabularyPageSize),
    nextOffset: result.words.length > vocabularyPageSize ? page.offset + vocabularyPageSize : null };
  return { revision: result.revision, valid: true, ...pageVocabulary(sortVocabulary(result.words), page, sort) };
}

function englishSortKey(sql, offset) {
  return sql`translate(normalize(lower((
    SELECT gloss FROM jsonb_array_elements_text(dictionary.detail #> '{meanings,eng}') WITH ORDINALITY AS item(gloss, n)
    WHERE btrim(gloss) <> '' ORDER BY n LIMIT 1 OFFSET ${offset}
  ) COLLATE "en-x-icu"), NFD), ${removedMarks}, '') COLLATE "en-x-icu"`;
}

let totalsRetryAt = 0;

export async function readPostgresVocabulary(sql, request) {
  if (request.mode === "practice-page" || request.mode === "practice-membership") {
    const read = request.mode === "practice-page" ? readPracticePage : readPracticeMembership;
    try { return await read(sql, request); }
    catch (error) {
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
