BEGIN;
SET LOCAL lock_timeout = '5s';

SELECT 1 FROM yomiru_incremental_head WHERE singleton FOR UPDATE;
LOCK TABLE yomiru_practice_title_posting, yomiru_practice_word_key IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS yomiru_practice_band_slot (
  term_id integer PRIMARY KEY REFERENCES yomiru_practice_word_key (term_id),
  slot integer GENERATED ALWAYS AS IDENTITY (MINVALUE 0 START WITH 0) UNIQUE
);

CREATE TABLE IF NOT EXISTS yomiru_practice_band (
  band integer PRIMARY KEY,
  ids integer[] NOT NULL,
  weights smallint[] NOT NULL
);

CREATE TABLE IF NOT EXISTS yomiru_practice_title_band (
  video_id text PRIMARY KEY,
  bands integer[] NOT NULL,
  values numeric[] NOT NULL,
  sparse bigint[] NOT NULL
);

CREATE OR REPLACE FUNCTION yomiru_refresh_practice_bands(changed integer[]) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO yomiru_practice_band (band, ids, weights)
  SELECT bands.band, array_agg(slot.term_id ORDER BY digit), array_agg(key.rank_weight ORDER BY digit)
  FROM (SELECT DISTINCT slot/32 AS band FROM yomiru_practice_band_slot
    WHERE changed IS NULL OR slot/32 = ANY(changed)) AS bands
  CROSS JOIN generate_series(0,31) AS digit
  LEFT JOIN yomiru_practice_band_slot AS slot ON slot.slot = bands.band*32+digit
  LEFT JOIN yomiru_practice_word_key AS key USING (term_id)
  GROUP BY bands.band
  ON CONFLICT (band) DO UPDATE SET ids = excluded.ids, weights = excluded.weights;
$$;

CREATE OR REPLACE FUNCTION yomiru_refresh_practice_title_bands(titles text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE changed integer[];
BEGIN
  IF titles IS NULL THEN RETURN; END IF;
  WITH added AS (
    INSERT INTO yomiru_practice_band_slot (term_id)
    SELECT DISTINCT (posting >> 32)::integer FROM yomiru_practice_title_posting AS title
    CROSS JOIN LATERAL unnest(title.postings) AS terms(posting)
    WHERE title.video_id = ANY(titles) AND NOT EXISTS (
      SELECT 1 FROM yomiru_practice_band_slot WHERE term_id = (posting >> 32)::integer
    ) ON CONFLICT DO NOTHING RETURNING slot
  ) SELECT array_agg(DISTINCT slot/32) INTO changed FROM added;
  IF changed IS NOT NULL THEN PERFORM yomiru_refresh_practice_bands(changed); END IF;

  DELETE FROM yomiru_practice_title_band WHERE video_id = ANY(titles);
  INSERT INTO yomiru_practice_title_band (video_id, bands, values, sparse)
  WITH entries AS MATERIALIZED (
    SELECT video_id, slot/32 AS band, slot%32 AS digit, posting,
      (posting & 2147483647)::integer AS count
    FROM yomiru_practice_title_posting CROSS JOIN LATERAL unnest(postings) AS terms(posting)
    JOIN yomiru_practice_band_slot ON term_id = (posting >> 32)::integer
    WHERE video_id = ANY(titles)
  ), dense AS (
    SELECT video_id,band FROM (
      SELECT video_id,band,count(*) AS terms,avg(count(*)) OVER (PARTITION BY video_id) AS average
      FROM entries WHERE count<=9999 GROUP BY video_id,band
    ) AS density WHERE terms>=16 OR average>=8
  ), positioned AS (
    SELECT entries.*, lag(digit,1,-1) OVER (PARTITION BY video_id,band ORDER BY digit) AS previous
    FROM entries JOIN dense USING (video_id,band) WHERE count<=9999
  ), packed AS (
    -- At most 10,000 titles can contribute to each 8-digit slot. Counts
    -- above 9,999 stay sparse so no sum can carry into the next word.
    SELECT video_id, band,
      (string_agg(repeat('0',8*(digit-previous-1)) || lpad(count::text,8,'0'), '' ORDER BY digit)
        || repeat('0',8*(31-max(digit))))::numeric AS value
    FROM positioned GROUP BY video_id,band
  ), residual AS (
    SELECT entries.video_id, array_agg(posting) AS sparse FROM entries
    LEFT JOIN dense USING (video_id,band) WHERE dense.band IS NULL OR entries.count>9999 GROUP BY entries.video_id
  )
  SELECT packed.video_id, array_agg(packed.band ORDER BY packed.band), array_agg(packed.value ORDER BY packed.band),
    coalesce(residual.sparse,'{}'::bigint[])
  FROM packed LEFT JOIN residual USING (video_id) GROUP BY packed.video_id,residual.sparse;
END;
$$;

CREATE OR REPLACE FUNCTION yomiru_on_practice_title_band_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE titles text[];
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    TRUNCATE yomiru_practice_title_band;
  ELSE
    IF TG_OP = 'INSERT' THEN
      SELECT array_agg(video_id) INTO titles FROM added_postings;
    ELSIF TG_OP = 'DELETE' THEN
      SELECT array_agg(video_id) INTO titles FROM removed_postings;
    ELSE
      SELECT array_agg(video_id) INTO titles FROM (
        SELECT video_id FROM added_postings UNION SELECT video_id FROM removed_postings
      ) AS changed;
    END IF;
    PERFORM yomiru_refresh_practice_title_bands(titles);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER yomiru_practice_title_band_insert AFTER INSERT ON yomiru_practice_title_posting
REFERENCING NEW TABLE AS added_postings FOR EACH STATEMENT EXECUTE FUNCTION yomiru_on_practice_title_band_change();
CREATE OR REPLACE TRIGGER yomiru_practice_title_band_update AFTER UPDATE ON yomiru_practice_title_posting
REFERENCING OLD TABLE AS removed_postings NEW TABLE AS added_postings
FOR EACH STATEMENT EXECUTE FUNCTION yomiru_on_practice_title_band_change();
CREATE OR REPLACE TRIGGER yomiru_practice_title_band_delete AFTER DELETE ON yomiru_practice_title_posting
REFERENCING OLD TABLE AS removed_postings FOR EACH STATEMENT EXECUTE FUNCTION yomiru_on_practice_title_band_change();
CREATE OR REPLACE TRIGGER yomiru_practice_title_band_truncate AFTER TRUNCATE ON yomiru_practice_title_posting
FOR EACH STATEMENT EXECUTE FUNCTION yomiru_on_practice_title_band_change();

CREATE OR REPLACE FUNCTION yomiru_on_practice_band_weight_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE changed integer[];
BEGIN
  SELECT array_agg(DISTINCT slot/32) INTO changed
  FROM prior_keys INNER JOIN updated_keys USING (term_id) JOIN yomiru_practice_band_slot USING (term_id)
  WHERE prior_keys.rank_weight IS DISTINCT FROM updated_keys.rank_weight;
  IF changed IS NOT NULL THEN PERFORM yomiru_refresh_practice_bands(changed); END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER yomiru_practice_band_weight AFTER UPDATE ON yomiru_practice_word_key
REFERENCING OLD TABLE AS prior_keys NEW TABLE AS updated_keys
FOR EACH STATEMENT EXECUTE FUNCTION yomiru_on_practice_band_weight_change();

-- Group words first encountered together. Replays and later publications keep their slots.
INSERT INTO yomiru_practice_band_slot (term_id)
SELECT key.term_id FROM yomiru_public_title_word AS word
JOIN yomiru_incremental_catalogue AS title ON title.id = word.video_id
JOIN yomiru_practice_word_key AS key USING (word_id)
WHERE NOT EXISTS (SELECT 1 FROM yomiru_practice_band_slot WHERE term_id = key.term_id)
GROUP BY key.term_id,key.word_id ORDER BY min(title.ordinal),key.word_id COLLATE "C"
ON CONFLICT DO NOTHING;
SELECT yomiru_refresh_practice_bands(NULL);
SELECT yomiru_refresh_practice_title_bands(array_agg(video_id)) FROM yomiru_practice_title_posting;

-- Store HMAC pads so signing uses only PostgreSQL's built-in SHA-256.
CREATE TABLE IF NOT EXISTS yomiru_practice_cursor_key (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  inner_pad bytea NOT NULL,
  outer_pad bytea NOT NULL
);
WITH seed AS MATERIALIZED (
  SELECT sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text,'UTF8')) AS secret
), bytes AS (
  SELECT n, CASE WHEN n < 32 THEN get_byte(secret,n) ELSE 0 END AS value
  FROM seed CROSS JOIN generate_series(0,63) AS n
)
INSERT INTO yomiru_practice_cursor_key (inner_pad,outer_pad)
SELECT decode(string_agg(lpad(to_hex(value # 54),2,'0'),'' ORDER BY n),'hex'),
       decode(string_agg(lpad(to_hex(value # 92),2,'0'),'' ORDER BY n),'hex') FROM bytes
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION yomiru_practice_cursor_signature(payload jsonb) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(outer_pad || sha256(inner_pad || convert_to(payload::text,'UTF8'))),'hex')
  FROM yomiru_practice_cursor_key WHERE singleton;
$$;

COMMIT;
