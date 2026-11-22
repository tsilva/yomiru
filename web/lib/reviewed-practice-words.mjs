export function reviewedRosterInput(videoId, { wordIds, supplementalCards = [] }) {
  return { video_id: videoId, word_ids: wordIds, supplemental: Object.fromEntries(
    supplementalCards.map(([id, , , , readingKey, , meanings]) => [id, [readingKey, meanings]]),
  ) };
}

// Use the current public card when present, just as the quiz does. Reviewed
// supplemental cards supply definitions for words outside the dictionary roster.
export function reviewedPracticeWords(sql, rosters) {
  return sql`
    WITH reviewed AS MATERIALIZED (
      SELECT * FROM jsonb_to_recordset(${sql.json(rosters)}::jsonb)
        AS source(video_id text, word_ids jsonb, supplemental jsonb)
    ), eligible AS (
      SELECT reviewed.video_id, card.word_id
      FROM reviewed CROSS JOIN LATERAL jsonb_array_elements_text(word_ids) AS target(word_id)
      JOIN yomiru_incremental_occurrence AS occurrence
        ON occurrence.video_id = reviewed.video_id AND occurrence.word_id = target.word_id
      JOIN yomiru_public_practice_card AS card ON card.word_id = target.word_id
      UNION
      SELECT video_id, word_id FROM reviewed CROSS JOIN LATERAL jsonb_object_keys(supplemental) AS card(word_id)
      WHERE word_ids ? word_id
    )
    SELECT eligible.video_id, eligible.word_id,
      coalesce(card.reading_key, reviewed.supplemental->eligible.word_id->>0) AS reading_key,
      coalesce(card.meaning_keys, ARRAY(
        SELECT jsonb_array_elements_text(reviewed.supplemental->eligible.word_id->1)
      )) AS meaning_keys
    FROM eligible JOIN reviewed USING (video_id)
    LEFT JOIN yomiru_public_practice_card AS card USING (word_id)`;
}
