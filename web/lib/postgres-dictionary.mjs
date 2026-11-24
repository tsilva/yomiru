import { toHiragana, toRomaji } from "wanakana";
import { conjugationVerbGroup } from "./conjugations.mjs";
import { vocabularyCategoryMap, vocabularyPageSize } from "../src/vocabulary-study.mjs";

const wordId = /^[A-Za-z0-9_.:-]{1,200}$/;
const revision = /^[a-f0-9]{64}$/;
const sorts = new Set(["frequency", "japanese", "meaning", "category", "subcategory"]);
const kana = start => Array.from({ length: 86 }, (_, index) => String.fromCodePoint(start + index)).join("");
const katakana = kana(0x30a1), hiragana = kana(0x3041);

export const dictionaryIdBatchSize = 128;

function validIds(ids, max) {
  return Array.isArray(ids) && ids.length <= max && new Set(ids).size === ids.length
    && ids.every(id => typeof id === "string" && wordId.test(id));
}

export function readDictionaryRequest(input) {
  const { mode, publication, query = "", category = "", offset = 0, sort = "frequency",
    direction = "descending", ids } = input ?? {};
  if (mode !== "dictionary" || typeof publication !== "string" || !revision.test(publication)
    || typeof query !== "string" || query.length > 100 || query.includes("\0")
    || typeof category !== "string" || category.length > 24
    || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000
    || !sorts.has(sort) || !["ascending", "descending"].includes(direction)
    || (ids !== undefined && (!validIds(ids, dictionaryIdBatchSize) || !ids.length || query || category || offset))) {
    return null;
  }
  return { publication, query, category, offset, sort, direction, ids };
}

function resultWord(row) {
  const { id, root, word, reading, romaji, pos, count, meanings, aliases, polite, verbClasses } = row;
  const verbGroup = polite ? conjugationVerbGroup(reading, [{ id: "polite-nonpast", kana: polite }])
    : verbClasses?.includes("vs-i") || verbClasses?.includes("vk") || verbClasses?.includes("vs-s") ? "irregular"
      : verbClasses?.some(type => type === "v1" || type === "v1-s") ? "ichidan"
        : verbClasses?.some(type => type.startsWith("v5")) ? "godan" : undefined;
  return { id, root, word, reading, romaji: romaji || toRomaji(reading), pos, count: Number(count),
    meanings, aliases, forms: [], ...(verbGroup && { verbGroup }) };
}

function searchTerms(query) {
  return toHiragana(query.normalize("NFKC").toLowerCase().trim(), { passRomaji: true })
    .split(/\s+/u).filter(Boolean).slice(0, 12).map(text => ({
    text, kana: /^[a-z]+$/u.test(text) ? toHiragana(text) : text,
    gloss: "\\m" + text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
  }));
}

export async function readPostgresDictionary(sql, request) {
  const { publication, ids, query, category, offset, sort, direction } = request;
  const terms = searchTerms(query);
  const limit = ids ? dictionaryIdBatchSize : vocabularyPageSize;
  const sortOrder = direction === "ascending" ? sql`ASC` : sql`DESC`;
  const sortField = {
    japanese: sql`reading COLLATE "ja-x-icu"`, meaning: sql`lower(meanings ->> 0)`,
    category: sql`category`, subcategory: sql`verb_class`, frequency: sql`count`,
  }[sort];
  const [head] = await sql`SELECT revision FROM yomiru_incremental_head WHERE singleton AND serving`;
  if (head?.revision !== publication) return { revision: head?.revision, valid: false };
  async function readRows({ publishedOnly = false, reading = "" } = {}) {
    const searching = terms.length && !reading;
    const dictionary = reading ? sql`(
      SELECT d.* FROM yomiru_incremental_dictionary AS d
      WHERE d.detail ? 'jmdictSenses' AND d.detail ->> 'reading' = ${reading}
      UNION ALL
      SELECT d.* FROM yomiru_public_word_total AS used
      JOIN yomiru_incremental_dictionary AS d ON d.id = used.word_id
      WHERE NOT d.detail ? 'jmdictSenses'
        AND translate(d.detail ->> 'reading', ${katakana}, ${hiragana}) = ${reading}
    )` : sql`yomiru_incremental_dictionary`;
    return sql`
    WITH terms AS MATERIALIZED (
      SELECT * FROM jsonb_to_recordset(${sql.json(terms)}) AS needle(text text, kana text, gloss text)
    ), ${searching ? sql`
      form_matches AS MATERIALIZED (
        SELECT form.value ->> 0 AS word_id, array_agg(DISTINCT needle.text) AS terms
        FROM yomiru_public_title_forms AS title
        JOIN yomiru_incremental_catalogue AS catalogue ON catalogue.id = title.video_id
          AND catalogue.detail ->> 'unlisted' IS DISTINCT FROM 'true'
        CROSS JOIN LATERAL jsonb_array_elements(title.forms) AS form
        JOIN terms AS needle ON position(needle.text IN translate(lower(form.value ->> 2), ${katakana}, ${hiragana})) > 0
          OR (needle.kana <> needle.text AND position(needle.kana IN translate(form.value ->> 2, ${katakana}, ${hiragana})) > 0)
        GROUP BY form.value ->> 0
      ),` : sql``} matching AS (
      SELECT d.id, d.detail, d.detail ->> 'reading' AS reading, d.detail ->> 'word' AS word,
        coalesce(nullif(d.detail ->> 'pos', ''), d.detail #>> '{jmdictSenses,0,pos,0}', '') AS pos,
        coalesce(d.detail #> '{meanings,eng}', '[]'::jsonb) AS meanings,
        coalesce(total.occurrences, 0) AS count,
        coalesce(d.jmdict_entry_id::text || ':' || (d.detail ->> 'reading'), d.id) AS root,
        d.detail ? 'jmdictSenses' AS seed,
        ${terms.length ? sql`CASE
          WHEN d.detail ->> 'word' = ${query} OR d.detail ->> 'reading' = ${terms.map(term => term.kana).join("")}
            OR d.detail -> 'aliases' ? ${query} THEN 0 ELSE 1 END` : sql`0`} AS match_rank
      FROM ${dictionary} AS d
      ${publishedOnly ? sql`JOIN` : sql`LEFT JOIN`} yomiru_public_word_total AS total ON total.word_id = d.id
      ${searching ? sql`LEFT JOIN form_matches AS form ON form.word_id = d.id` : sql``}
      WHERE d.detail ->> 'reading' <> ''
        ${ids ? sql`AND d.id = ANY(${sql.array(ids, 25)})` : sql``}
        ${searching ? sql`AND NOT EXISTS (
          SELECT 1 FROM terms AS needle
          WHERE position(needle.text IN translate(lower(normalize(concat_ws(' ', d.detail ->> 'word',
            d.detail ->> 'reading', d.detail ->> 'romaji', d.detail -> 'aliases'), NFKC)), ${katakana}, ${hiragana})) = 0
            AND (needle.kana = needle.text OR position(needle.kana IN (d.detail ->> 'reading')) = 0)
            AND lower(coalesce((d.detail #> '{meanings,eng}')::text, '')) !~ needle.gloss
            AND NOT coalesce(needle.text = ANY(form.terms), false)
        )` : sql``}
    ), ranked AS (
      SELECT DISTINCT ON (root) id, detail, word, reading, pos, meanings, count, root,
        match_rank,
        coalesce(${sql.json(vocabularyCategoryMap)}::jsonb ->> split_part(pos, '/', 1), 'Other') AS category,
        detail #>> '{jmdictSenses,0,verbClasses,0}' AS verb_class
      FROM matching
      WHERE (${category} = '' OR coalesce(${sql.json(vocabularyCategoryMap)}::jsonb ->> split_part(pos, '/', 1), 'Other') = ${category})
      ORDER BY root, count DESC, seed DESC, id
    )
    SELECT id, word, reading, detail ->> 'romaji' AS romaji, pos, meanings, count, root,
      detail -> 'aliases' AS aliases, detail #> '{jmdictSenses,0,verbClasses}' AS "verbClasses",
      jsonb_path_query_first(detail -> 'conjugations' -> word,
        '$[*] ? (@.id == "polite-nonpast").kana') #>> '{}' AS polite
    FROM ranked
    ORDER BY match_rank, ${sortField} ${sortOrder} NULLS LAST, count DESC, reading COLLATE "ja-x-icu", id
    LIMIT ${limit + 1} OFFSET ${offset}`;
  }
  const fastPage = !ids && !terms.length && !category && sort === "frequency" && direction === "descending";
  const reading = terms.length === 1 && /^[ぁ-ゖゝゞー]+$/u.test(terms[0].text) ? terms[0].text : "";
  let rows = fastPage ? await readRows({ publishedOnly: true }) : reading ? await readRows({ reading }) : [];
  if (fastPage ? rows.length <= limit : !rows.length) rows = await readRows();
  return { revision: publication, valid: true,
    words: rows.slice(0, limit).map(resultWord), nextOffset: rows.length > limit ? offset + limit : null };
}
