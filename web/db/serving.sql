BEGIN;
SET LOCAL lock_timeout = '5s';

-- Follow the publisher's lock order and keep the backfill and triggers atomic.
SELECT 1 FROM yomiru_incremental_head WHERE singleton FOR UPDATE;
LOCK TABLE yomiru_incremental_catalogue, yomiru_incremental_occurrence IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS yomiru_public_title_word (
  video_id text NOT NULL,
  word_id text NOT NULL,
  occurrences integer NOT NULL CHECK (occurrences > 0),
  PRIMARY KEY (video_id, word_id) INCLUDE (occurrences)
);

CREATE TABLE IF NOT EXISTS yomiru_public_title_forms (
  video_id text PRIMARY KEY,
  forms jsonb NOT NULL
);

CREATE OR REPLACE VIEW yomiru_public_source_forms AS
  SELECT o.video_id, o.word_id, form.kind, form.value
  FROM yomiru_incremental_occurrence AS o CROSS JOIN LATERAL (
    SELECT 'forms' AS kind, value FROM jsonb_array_elements_text(NULLIF(o.detail -> 'forms', 'null'::jsonb))
    UNION ALL
    SELECT 'formReadings', value FROM jsonb_array_elements_text(NULLIF(o.detail -> 'formReadings', 'null'::jsonb))
  ) AS form;

CREATE OR REPLACE FUNCTION yomiru_refresh_title_forms(ids text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ids IS NULL THEN RETURN; END IF;
  DELETE FROM yomiru_public_title_forms WHERE video_id = ANY(ids);
  INSERT INTO yomiru_public_title_forms (video_id, forms)
    SELECT video_id, jsonb_agg(jsonb_build_array(word_id, kind, value))
    FROM yomiru_public_source_forms WHERE video_id = ANY(ids) GROUP BY video_id;
END;
$$;

CREATE TABLE IF NOT EXISTS yomiru_public_word_total (
  word_id text PRIMARY KEY,
  occurrences bigint NOT NULL CHECK (occurrences >= 0)
);

CREATE INDEX IF NOT EXISTS yomiru_public_word_frequency
  ON yomiru_public_word_total (occurrences DESC, word_id);

CREATE TABLE IF NOT EXISTS yomiru_public_lexeme (
  word_id text PRIMARY KEY,
  search_text text NOT NULL,
  first_meaning text,
  second_meaning text
);

CREATE OR REPLACE FUNCTION yomiru_search_normalized(value text, fold_kana boolean) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT translate(normalize(
    CASE WHEN fold_kana THEN translate(lower(normalize(value, NFKC) COLLATE "und-x-icu"),
      (SELECT string_agg(chr(code), '' ORDER BY code) FROM generate_series(12449, 12534) AS code),
      (SELECT string_agg(chr(code), '' ORDER BY code) FROM generate_series(12353, 12438) AS code))
    ELSE lower(normalize(value, NFKC) COLLATE "und-x-icu") END, NFD),
    (SELECT string_agg(chr(code), '' ORDER BY code) FROM generate_series(768, 879) AS code), '');
$$;

CREATE OR REPLACE FUNCTION yomiru_write_public_lexeme(id text, detail jsonb) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO yomiru_public_lexeme (word_id, search_text, first_meaning, second_meaning)
  SELECT id, yomiru_search_normalized(concat_ws(' ', detail ->> 'word', detail ->> 'reading', detail ->> 'romaji',
    (SELECT string_agg(value, ' ') FROM jsonb_array_elements_text(NULLIF(detail -> 'aliases', 'null'::jsonb))),
    (SELECT string_agg(value, ' ') FROM jsonb_array_elements_text(detail #> '{meanings,eng}'))), true),
    yomiru_search_normalized(glosses.items[1], false),
    yomiru_search_normalized(glosses.items[2], false)
  FROM (SELECT array_agg(gloss ORDER BY n) AS items
    FROM jsonb_array_elements_text(detail #> '{meanings,eng}') WITH ORDINALITY AS item(gloss,n)
    WHERE btrim(gloss) <> '') AS glosses
  ON CONFLICT (word_id) DO UPDATE SET search_text = excluded.search_text,
    first_meaning = excluded.first_meaning, second_meaning = excluded.second_meaning;
$$;

CREATE OR REPLACE FUNCTION yomiru_project_visible_lexeme() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM yomiru_public_lexeme WHERE word_id = OLD.word_id;
  ELSE
    PERFORM yomiru_write_public_lexeme(d.id, d.detail) FROM yomiru_incremental_dictionary AS d WHERE d.id = NEW.word_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER yomiru_public_lexeme_membership
AFTER INSERT OR DELETE ON yomiru_public_word_total
FOR EACH ROW EXECUTE FUNCTION yomiru_project_visible_lexeme();

CREATE OR REPLACE FUNCTION yomiru_refresh_changed_lexeme() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM yomiru_public_lexeme WHERE word_id = NEW.id) THEN
    PERFORM yomiru_write_public_lexeme(NEW.id, NEW.detail);
  END IF;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER yomiru_public_lexeme_refresh
AFTER UPDATE OF detail ON yomiru_incremental_dictionary
FOR EACH ROW WHEN (OLD.detail IS DISTINCT FROM NEW.detail)
EXECUTE FUNCTION yomiru_refresh_changed_lexeme();

CREATE TABLE IF NOT EXISTS yomiru_public_vocabulary_summary (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  total integer NOT NULL,
  english integer NOT NULL,
  episode_count integer NOT NULL,
  movie_count integer NOT NULL
);

CREATE OR REPLACE FUNCTION yomiru_apply_word_counts(ids text[], changes bigint[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ids IS NULL THEN RETURN; END IF;
  WITH delta AS (SELECT word_id, occurrences FROM unnest(ids, changes) AS d(word_id, occurrences)),
  updated AS (
    UPDATE yomiru_public_word_total AS total
    SET occurrences = total.occurrences + delta.occurrences
    FROM delta WHERE total.word_id = delta.word_id
    RETURNING total.word_id
  )
  INSERT INTO yomiru_public_word_total (word_id, occurrences)
    SELECT word_id, occurrences FROM delta
    WHERE NOT EXISTS (SELECT 1 FROM updated WHERE updated.word_id = delta.word_id)
    ON CONFLICT (word_id) DO UPDATE
      SET occurrences = yomiru_public_word_total.occurrences + excluded.occurrences;
  DELETE FROM yomiru_public_word_total WHERE occurrences = 0 AND word_id = ANY(ids);
END;
$$;

CREATE OR REPLACE FUNCTION yomiru_apply_occurrence_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rows_sql text;
  titles text[];
  ids text[];
  changes bigint[];
BEGIN
  IF TG_OP <> 'INSERT' THEN
    DELETE FROM yomiru_public_title_word AS w USING prior_rows AS o
      WHERE (w.video_id, w.word_id) = (o.video_id, o.word_id);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    INSERT INTO yomiru_public_title_word (video_id, word_id, occurrences)
      SELECT video_id, word_id, (detail ->> 'count')::int FROM next_rows;
  END IF;
  IF TG_OP = 'INSERT' THEN
    rows_sql := 'SELECT video_id, word_id, (detail ->> ''count'')::integer AS n FROM next_rows';
  ELSIF TG_OP = 'DELETE' THEN
    rows_sql := 'SELECT video_id, word_id, -(detail ->> ''count'')::integer AS n FROM prior_rows';
  ELSE
    rows_sql := 'SELECT video_id, word_id, (detail ->> ''count'')::integer AS n FROM next_rows
                 UNION ALL SELECT video_id, word_id, -(detail ->> ''count'')::integer FROM prior_rows';
  END IF;
  EXECUTE 'SELECT array_agg(DISTINCT video_id) FROM (' || rows_sql || ') AS changed' INTO titles;
  PERFORM yomiru_refresh_title_forms(titles);
  EXECUTE 'SELECT array_agg(word_id ORDER BY word_id), array_agg(n ORDER BY word_id)
    FROM (SELECT o.word_id, sum(o.n) AS n FROM (' || rows_sql || ') AS o
          JOIN yomiru_incremental_catalogue AS c ON c.id = o.video_id
          WHERE c.detail ->> ''unlisted'' IS DISTINCT FROM ''true''
          GROUP BY o.word_id HAVING sum(o.n) <> 0) AS delta' INTO ids, changes;
  PERFORM yomiru_apply_word_counts(ids, changes);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER yomiru_public_occurrences_insert
AFTER INSERT ON yomiru_incremental_occurrence REFERENCING NEW TABLE AS next_rows
FOR EACH STATEMENT EXECUTE FUNCTION yomiru_apply_occurrence_changes();
CREATE OR REPLACE TRIGGER yomiru_public_occurrences_delete
AFTER DELETE ON yomiru_incremental_occurrence REFERENCING OLD TABLE AS prior_rows
FOR EACH STATEMENT EXECUTE FUNCTION yomiru_apply_occurrence_changes();
CREATE OR REPLACE TRIGGER yomiru_public_occurrences_update
AFTER UPDATE ON yomiru_incremental_occurrence REFERENCING OLD TABLE AS prior_rows NEW TABLE AS next_rows
FOR EACH STATEMENT EXECUTE FUNCTION yomiru_apply_occurrence_changes();

CREATE OR REPLACE FUNCTION yomiru_apply_catalogue_visibility() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  was_listed boolean := TG_OP <> 'INSERT' AND OLD.detail ->> 'unlisted' IS DISTINCT FROM 'true';
  is_listed boolean := TG_OP <> 'DELETE' AND NEW.detail ->> 'unlisted' IS DISTINCT FROM 'true';
  ids text[];
  changes bigint[];
BEGIN
  IF was_listed = is_listed THEN RETURN NULL; END IF;
  SELECT array_agg(word_id ORDER BY word_id), array_agg(
    (detail ->> 'count')::bigint * (CASE WHEN is_listed THEN 1 ELSE -1 END) ORDER BY word_id)
    INTO ids, changes FROM yomiru_incremental_occurrence WHERE video_id = coalesce(NEW.id, OLD.id);
  PERFORM yomiru_apply_word_counts(ids, changes);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER yomiru_public_catalogue_visibility
AFTER INSERT OR UPDATE OR DELETE ON yomiru_incremental_catalogue
FOR EACH ROW EXECUTE FUNCTION yomiru_apply_catalogue_visibility();

CREATE OR REPLACE FUNCTION yomiru_refresh_vocabulary_summary() RETURNS void
LANGUAGE sql AS $$
  INSERT INTO yomiru_public_vocabulary_summary (total, english, episode_count, movie_count)
  SELECT words.total, words.english, titles.total, titles.movies
  FROM (
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE jsonb_array_length(d.detail #> '{meanings,eng}') > 0)::int AS english
    FROM yomiru_public_word_total AS t JOIN yomiru_incremental_dictionary AS d ON d.id = t.word_id
  ) AS words CROSS JOIN (
    SELECT count(*)::int AS total, count(*) FILTER (WHERE c.id ~ '^tt[0-9]+$')::int AS movies
    FROM yomiru_incremental_catalogue AS c JOIN yomiru_incremental_vocabulary AS v ON v.video_id = c.id
    WHERE c.detail ->> 'unlisted' IS DISTINCT FROM 'true'
  ) AS titles
  ON CONFLICT (singleton) DO UPDATE SET total = excluded.total, english = excluded.english,
    episode_count = excluded.episode_count, movie_count = excluded.movie_count;
$$;

CREATE OR REPLACE FUNCTION yomiru_on_published_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM yomiru_refresh_vocabulary_summary();
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER yomiru_public_vocabulary_summary_refresh
AFTER INSERT OR UPDATE OF revision ON yomiru_incremental_head
FOR EACH ROW EXECUTE FUNCTION yomiru_on_published_revision();

-- The repeatable backfill only touches derived data.
TRUNCATE yomiru_public_lexeme, yomiru_public_title_word, yomiru_public_word_total, yomiru_public_title_forms;
INSERT INTO yomiru_public_title_word (video_id, word_id, occurrences)
SELECT video_id, word_id, (detail ->> 'count')::int FROM yomiru_incremental_occurrence;
INSERT INTO yomiru_public_title_forms (video_id, forms)
SELECT video_id, jsonb_agg(jsonb_build_array(word_id, kind, value))
FROM yomiru_public_source_forms GROUP BY video_id;
INSERT INTO yomiru_public_word_total (word_id, occurrences)
SELECT o.word_id, sum(o.occurrences)
FROM yomiru_public_title_word AS o JOIN yomiru_incremental_catalogue AS c ON c.id = o.video_id
WHERE c.detail ->> 'unlisted' IS DISTINCT FROM 'true'
GROUP BY o.word_id;
SELECT yomiru_refresh_vocabulary_summary();

COMMIT;
