BEGIN;

-- Run as the database owner. Set the login password separately on first install.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yomiru_corpus_ingest') THEN
    CREATE ROLE yomiru_corpus_ingest LOGIN NOINHERIT NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS yomiru_corpus_publisher;
REVOKE ALL ON SCHEMA yomiru_corpus_publisher FROM PUBLIC;

CREATE OR REPLACE FUNCTION yomiru_corpus_publisher.ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
RETURN to_regclass('yomiru_subtitle_corpus.source_cue') IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.yomiru_incremental_head WHERE singleton AND serving);

CREATE OR REPLACE FUNCTION yomiru_corpus_publisher.prepare(document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $corpus$
DECLARE
  title_record jsonb := document #> '{titles,0}';
  source_record jsonb := document #> '{sources,0}';
  translation_record jsonb := document #> '{translations,0}';
  choice_record jsonb := document #> '{choices,0}';
  context_record jsonb := document #> '{contexts,0}';
  review_record jsonb := document -> 'releaseReview';
  reviewed_practice jsonb := nullif(review_record -> 'practice', 'null'::jsonb);
  publication_id text := document ->> 'publication';
  video_id_value text := title_record ->> 'videoId';
  source_id text := source_record ->> 'id';
  anchor_value text := source_record ->> 'anchor';
  translation_id_value text := translation_record ->> 'id';
  generation_value text := translation_record ->> 'generation';
  language_value text := translation_record ->> 'language';
  source_cues jsonb;
  translation_cues jsonb;
  hash_pattern constant text := '^[0-9a-f]{64}$';
BEGIN
  IF NOT coalesce(
    document ->> 'version' = '1'
    AND jsonb_array_length(document -> 'titles') = 1
    AND jsonb_array_length(document -> 'sources') = 1
    AND jsonb_array_length(document -> 'translations') = 1
    AND jsonb_array_length(document -> 'choices') = 1
    AND jsonb_array_length(document -> 'contexts') = 1
    AND jsonb_array_length(document -> 'tracks') BETWEEN 1 AND 4
    AND jsonb_array_length(document -> 'renditions') BETWEEN 1 AND 4
    AND publication_id ~ hash_pattern
    AND video_id_value ~ '^tt[0-9]{5,12}(:[0-9]{1,5}:[0-9]{1,5})?$'
    AND source_id ~ hash_pattern AND anchor_value ~ hash_pattern
    AND generation_value ~ hash_pattern AND translation_id_value ~ hash_pattern
    AND title_record ->> 'sourceRevision' = source_id AND title_record ->> 'anchor' = anchor_value
    AND translation_record ->> 'sourceRevision' = source_id AND translation_record ->> 'provenance' = 'paired'
    AND context_record ->> 'sourceRevision' = source_id AND language_value IN ('eng', 'por')
    AND choice_record ->> 'videoId' = video_id_value AND choice_record ->> 'language' = language_value
    AND choice_record ->> 'translationId' = translation_id_value
    AND jsonb_array_length(source_record -> 'cues') BETWEEN 1 AND 15000
    AND jsonb_array_length(source_record -> 'cues') = jsonb_array_length(translation_record -> 'cues')
    AND jsonb_array_length(context_record -> 'examples') BETWEEN 0 AND 100000, false)
  THEN
    RAISE EXCEPTION 'Expected one validated episode corpus';
  END IF;

  IF NOT coalesce(
    review_record ->> 'version' = '1' AND review_record ->> 'reviewId' ~ hash_pattern
    AND review_record ->> 'vocabularyRevision' ~ hash_pattern AND review_record ->> 'vocabularyDigest' ~ hash_pattern
    AND review_record ->> 'videoId' = video_id_value AND review_record ->> 'sourceRevision' = source_id
    AND review_record ->> 'translationId' = translation_id_value
    AND CASE WHEN language_value = 'eng' THEN
      reviewed_practice ->> 'version' = '1' AND reviewed_practice ->> 'kind' = 'practice-cues'
      AND reviewed_practice ->> 'prepared' = 'true' AND reviewed_practice ->> 'anchor' = anchor_value
      AND reviewed_practice ->> 'sourceRevision' = source_id
      AND reviewed_practice ->> 'translationId' = translation_id_value
      AND jsonb_array_length(reviewed_practice -> 'cues') = jsonb_array_length(source_record -> 'cues')
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(reviewed_practice -> 'cues') AS p(cue)
        WHERE jsonb_array_length(cue -> 5) > 0)
    ELSE reviewed_practice IS NULL END, false)
  THEN
    RAISE EXCEPTION 'Expected a completed subtitle and Practice release review';
  END IF;

  IF language_value = 'eng' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(reviewed_practice -> 'cues') WITH ORDINALITY AS p(cue, position)
    JOIN jsonb_array_elements(source_record -> 'cues') WITH ORDINALITY AS s(source, position) USING (position)
    JOIN jsonb_array_elements(translation_record -> 'cues') WITH ORDINALITY AS t(line, position) USING (position)
    WHERE (cue ->> 0, cue ->> 4, reviewed_practice -> 'coverage' -> (cue ->> 0) ->> 'japanese')
      IS DISTINCT FROM (source ->> 'id', line ->> 'text', source ->> 'japanese')
  ) THEN
    RAISE EXCEPTION 'Reviewed Practice cues do not match the paired release';
  END IF;

  -- Prevent concurrent changes to the episode archive while checking the active source.
  PERFORM pg_advisory_xact_lock(hashtextextended('yomiru-subtitle-corpus', 0));
  PERFORM 1 FROM public.yomiru_incremental_head WHERE singleton AND serving FOR UPDATE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.yomiru_incremental_vocabulary AS v
    WHERE v.video_id = video_id_value
      AND (v.anchor <> anchor_value OR (v.manifest_sha256 IS NOT NULL AND v.manifest_sha256 <> source_id))
  ) OR EXISTS (
    SELECT 1 FROM public.yomiru_practice_context_title AS c WHERE c.video_id = video_id_value
      AND (c.anchor <> anchor_value OR c.source_revision <> source_id)
  ) THEN
    RAISE EXCEPTION 'The episode source changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(document -> 'tracks') AS t(track)
    WHERE NOT coalesce(
      track ->> 'translationId' = translation_id_value
      AND track #>> '{descriptor,anchor}' = anchor_value
      AND track #>> '{descriptor,generation}' = generation_value
      AND track #>> '{descriptor,lang}' = language_value
      AND track #> '{descriptor,videoIds}' = jsonb_build_array(video_id_value)
      AND track #>> '{descriptor,type}' = CASE WHEN strpos(video_id_value, ':') > 0 THEN 'series' ELSE 'movie' END
      AND track #>> '{descriptor,superseded}' IS DISTINCT FROM 'true'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(document -> 'renditions') AS r(asset)
        WHERE asset ->> 'sha256' = track #>> '{descriptor,sha256}'
          AND asset ->> 'bytes' = track #>> '{descriptor,bytes}'), false)
  ) OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(document -> 'tracks') AS t(track)
    WHERE track #>> '{descriptor,id}' = translation_record ->> 'trackId'
  ) THEN
    RAISE EXCEPTION 'Staged tracks must belong to the requested episode and translation';
  END IF;

  INSERT INTO yomiru_subtitle_corpus.publication VALUES (publication_id) ON CONFLICT DO NOTHING;
  INSERT INTO yomiru_subtitle_corpus.source (id, anchor, word_ids)
  VALUES (source_id, anchor_value, ARRAY(SELECT jsonb_array_elements_text(source_record -> 'wordIds')))
  ON CONFLICT DO NOTHING;
  INSERT INTO yomiru_subtitle_corpus.source_cue
    (source_revision, cue_id, ordinal, start_ms, end_ms, japanese, reading_source, tokens)
  SELECT source_id, cue ->> 'id', position, (cue ->> 'start')::int, (cue ->> 'end')::int,
    cue ->> 'japanese', cue ->> 'reading_source', cue -> 'tokens'
  FROM jsonb_array_elements(source_record -> 'cues') WITH ORDINALITY AS row(cue, position)
  ON CONFLICT DO NOTHING;
  INSERT INTO yomiru_subtitle_corpus.translation (id, source_revision, language, provenance, generation, track_id)
  VALUES (translation_id_value, source_id, language_value, 'paired', generation_value, translation_record ->> 'trackId')
  ON CONFLICT DO NOTHING;
  INSERT INTO yomiru_subtitle_corpus.translation_cue (translation_id, ordinal, cue_id, start_ms, end_ms, text)
  SELECT translation_id_value, position, cue ->> 'id', (cue ->> 'start')::int, (cue ->> 'end')::int, cue ->> 'text'
  FROM jsonb_array_elements(translation_record -> 'cues') WITH ORDINALITY AS row(cue, position)
  ON CONFLICT DO NOTHING;

  -- Return the stored, ordered cues for rendering and detect conflicting immutable rows.
  SELECT jsonb_agg(jsonb_build_object('id', cue_id, 'start', start_ms, 'end', end_ms,
    'japanese', japanese, 'reading_source', reading_source, 'tokens', tokens) ORDER BY ordinal)
  INTO source_cues FROM yomiru_subtitle_corpus.source_cue WHERE source_revision = source_id;
  SELECT jsonb_agg(jsonb_build_object('id', cue_id, 'start', start_ms, 'end', end_ms, 'text', text) ORDER BY ordinal)
  INTO translation_cues FROM yomiru_subtitle_corpus.translation_cue WHERE translation_id = translation_id_value;
  IF source_cues IS DISTINCT FROM source_record -> 'cues'
    OR translation_cues IS DISTINCT FROM translation_record -> 'cues'
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(source_cues) WITH ORDINALITY AS s(cue, position)
      JOIN jsonb_array_elements(translation_cues) WITH ORDINALITY AS t(cue, position) USING (position)
      WHERE (s.cue -> 'id', s.cue -> 'start', s.cue -> 'end')
        IS DISTINCT FROM (t.cue -> 'id', t.cue -> 'start', t.cue -> 'end')
    ) OR NOT EXISTS (
      SELECT 1 FROM yomiru_subtitle_corpus.translation
      WHERE id = translation_id_value AND source_revision = source_id AND language = language_value
        AND provenance = 'paired' AND generation = generation_value
        AND track_id = translation_record ->> 'trackId'
    ) OR NOT EXISTS (
      SELECT 1 FROM yomiru_subtitle_corpus.source
      WHERE id = source_id AND anchor = anchor_value AND to_jsonb(word_ids) = source_record -> 'wordIds'
    ) THEN
    RAISE EXCEPTION 'Canonical subtitle cue rows differ';
  END IF;

  INSERT INTO yomiru_subtitle_corpus.title VALUES (publication_id, video_id_value, source_id) ON CONFLICT DO NOTHING;
  INSERT INTO yomiru_subtitle_corpus.choice
    VALUES (publication_id, video_id_value, source_id, language_value, translation_id_value) ON CONFLICT DO NOTHING;
  INSERT INTO yomiru_subtitle_corpus.rendition
  SELECT * FROM jsonb_populate_recordset(NULL::yomiru_subtitle_corpus.rendition, document -> 'renditions')
  ON CONFLICT DO NOTHING;
  INSERT INTO yomiru_subtitle_corpus.track (publication, id, sha256, translation_id, descriptor)
  SELECT publication_id, track #>> '{descriptor,id}', track #>> '{descriptor,sha256}',
    translation_id_value, track -> 'descriptor' FROM jsonb_array_elements(document -> 'tracks') AS t(track)
  ON CONFLICT DO NOTHING;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(document -> 'tracks') AS t(track)
    WHERE NOT EXISTS (
      SELECT 1 FROM yomiru_subtitle_corpus.track AS stored JOIN yomiru_subtitle_corpus.rendition AS asset USING (sha256)
      WHERE stored.publication = publication_id AND stored.id = track #>> '{descriptor,id}'
        AND stored.descriptor = track -> 'descriptor' AND stored.translation_id = translation_id_value
        AND asset.bytes::text = track #>> '{descriptor,bytes}'
        AND asset.sha256 = encode(sha256(convert_to(asset.header || array_to_string(asset.events, E'\n'), 'UTF8')), 'hex')
    )
  ) OR NOT EXISTS (
    SELECT 1 FROM yomiru_subtitle_corpus.choice c WHERE c.publication = publication_id AND c.video_id = video_id_value
      AND c.language = language_value AND c.source_revision = source_id AND c.translation_id = translation_id_value
  ) THEN
    RAISE EXCEPTION 'Subtitle rendition or translation selection differs';
  END IF;

  -- Keep existing reviewed contexts for a current English track when adding another language.
  IF language_value = 'eng' THEN
    IF EXISTS (
      SELECT 1 FROM public.yomiru_practice_context_title
      WHERE source_revision = source_id AND video_id <> video_id_value
    ) THEN
      RAISE EXCEPTION 'A shared Practice source requires explicit alias handling';
    END IF;
    INSERT INTO public.yomiru_practice_context_title (video_id, anchor, source_revision, publication)
    VALUES (video_id_value, anchor_value, source_id, publication_id) ON CONFLICT (video_id) DO NOTHING;
    INSERT INTO public.yomiru_practice_cue (source_revision, cue_id, hiragana, romaji, word_peeks)
    SELECT source_id, cue ->> 0, cue ->> 1, cue ->> 2, cue -> 3
    FROM jsonb_array_elements(context_record -> 'cues') AS c(cue)
    JOIN yomiru_subtitle_corpus.source_cue AS stored
      ON stored.source_revision = source_id AND stored.cue_id = cue ->> 0
    ON CONFLICT DO NOTHING;
    INSERT INTO public.yomiru_practice_example
      (source_revision, cue_id, word_id, gloss_key, hiragana_start, hiragana_end, romaji_start, romaji_end)
    SELECT source_id, example ->> 0, example ->> 1, example ->> 2,
      (example ->> 3)::smallint, (example ->> 4)::smallint, (example ->> 5)::smallint, (example ->> 6)::smallint
    FROM jsonb_array_elements(context_record -> 'examples') AS e(example)
    JOIN jsonb_array_elements(context_record -> 'cues') AS c(cue) ON cue ->> 0 = example ->> 0
    JOIN public.yomiru_practice_cue AS stored ON stored.source_revision = source_id
      AND stored.cue_id = cue ->> 0 AND stored.hiragana = cue ->> 1 AND stored.romaji = cue ->> 2
    WHERE (source_record -> 'wordIds') ? (example ->> 1)
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO yomiru_subtitle_corpus.release_review
    (video_id, translation_id, vocabulary_revision, review_id, practice)
  VALUES (video_id_value, translation_id_value, review_record ->> 'vocabularyRevision',
    review_record ->> 'reviewId', reviewed_practice)
  ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM yomiru_subtitle_corpus.release_review AS r
    WHERE r.video_id = video_id_value AND r.translation_id = translation_id_value
      AND r.vocabulary_revision = review_record ->> 'vocabularyRevision'
      AND r.review_id = review_record ->> 'reviewId' AND r.practice IS NOT DISTINCT FROM reviewed_practice)
  THEN
    RAISE EXCEPTION 'Stored episode review differs';
  END IF;

  RETURN jsonb_build_object('videoId', video_id_value, 'reviewId', review_record ->> 'reviewId',
    'source', jsonb_build_object('cues', source_cues),
    'translation', jsonb_build_object('cues', translation_cues));
END;
$corpus$;

REVOKE ALL ON FUNCTION yomiru_corpus_publisher.ready(), yomiru_corpus_publisher.prepare(jsonb) FROM PUBLIC;
GRANT USAGE ON SCHEMA yomiru_corpus_publisher TO yomiru_corpus_ingest;
GRANT EXECUTE ON FUNCTION yomiru_corpus_publisher.ready(), yomiru_corpus_publisher.prepare(jsonb) TO yomiru_corpus_ingest;
COMMIT;
