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

export function practiceExamples(sql, revisions, word, gloss) {
  return sql`(
    SELECT jsonb_agg(jsonb_build_array(source_revision||':'||cue_id, hiragana, romaji,
      hiragana_start, hiragana_end, romaji_start, romaji_end) ORDER BY source_revision, cue_id)
    FROM (
      SELECT source_revision, cue_id, hiragana_start, hiragana_end, romaji_start, romaji_end
      FROM yomiru_practice_example
      WHERE source_revision=ANY(${revisions}) AND word_id=${word} AND gloss_key=${gloss}
      ORDER BY source_revision, cue_id LIMIT 2
    ) AS examples JOIN yomiru_practice_cue USING (source_revision, cue_id)
  )`;
}

export async function addLocalPracticeExamples(sql, page, selection, pilotRevision) {
  const cards = [...page.cards, ...page.reviews];
  if (!cards.length) return page;
  const selected = practiceSourceRevisions(sql, selection);
  const revisions = pilotRevision ? sql`(CASE WHEN EXISTS (SELECT 1 FROM yomiru_practice_context_title)
    THEN ${selected} ELSE ARRAY[${pilotRevision}::text] END)` : selected;
  const results = await sql`
    SELECT ${practiceExamples(sql, revisions, sql`card.item->>0`, sql`card.item->>5`)} AS examples
    FROM jsonb_array_elements(${sql.json(cards)}::jsonb) WITH ORDINALITY AS card(item, position)
    ORDER BY card.position`;
  const enriched = cards.map((card, index) => results[index].examples ? [...card.slice(0, 10), results[index].examples] : card);
  return { ...page, cards: enriched.slice(0, page.cards.length), reviews: enriched.slice(page.cards.length) };
}
