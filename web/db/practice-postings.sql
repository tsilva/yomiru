BEGIN;
SET LOCAL lock_timeout = '5s';

SELECT 1 FROM yomiru_incremental_head WHERE singleton FOR UPDATE;
LOCK TABLE yomiru_public_title_word, yomiru_public_practice_card IN SHARE ROW EXCLUSIVE MODE;

-- The numeric key survives dictionary corrections and temporary withdrawal.
-- A null weight means the word is currently ineligible for practice.
CREATE TABLE IF NOT EXISTS yomiru_practice_word_key (
  term_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  word_id text UNIQUE NOT NULL,
  rank_weight smallint CHECK (rank_weight IN (1, 4))
);

CREATE TABLE IF NOT EXISTS yomiru_practice_title_posting (
  video_id text PRIMARY KEY,
  postings bigint[] NOT NULL
);

CREATE OR REPLACE FUNCTION yomiru_refresh_practice_postings(titles text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF titles IS NULL THEN RETURN; END IF;

  INSERT INTO yomiru_practice_word_key (word_id, rank_weight)
    SELECT word.word_id, CASE WHEN card.lower_priority THEN 1 WHEN card.word_id IS NOT NULL THEN 4 END
    FROM (SELECT DISTINCT word_id FROM yomiru_public_title_word WHERE video_id = ANY(titles)) AS word
    LEFT JOIN yomiru_public_practice_card AS card USING (word_id)
    WHERE NOT EXISTS (SELECT 1 FROM yomiru_practice_word_key AS key WHERE key.word_id = word.word_id)
    ON CONFLICT (word_id) DO NOTHING;

  -- The high 32 bits identify the word and the low 32 hold its exact title count.
  DELETE FROM yomiru_practice_title_posting WHERE video_id = ANY(titles);
  INSERT INTO yomiru_practice_title_posting (video_id, postings)
    SELECT word.video_id, array_agg((key.term_id::bigint << 32) | word.occurrences::bigint)
    FROM yomiru_public_title_word AS word JOIN yomiru_practice_word_key AS key USING (word_id)
    WHERE word.video_id = ANY(titles) GROUP BY word.video_id;
END;
$$;

CREATE OR REPLACE FUNCTION yomiru_on_practice_posting_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE titles text[];
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    TRUNCATE yomiru_practice_title_posting;
  ELSE
    IF TG_OP = 'INSERT' THEN
      SELECT array_agg(DISTINCT video_id) INTO titles FROM next_words;
    ELSIF TG_OP = 'DELETE' THEN
      SELECT array_agg(DISTINCT video_id) INTO titles FROM prior_words;
    ELSE
      SELECT array_agg(video_id) INTO titles FROM (
        SELECT video_id FROM prior_words UNION SELECT video_id FROM next_words
      ) AS changed;
    END IF;
    PERFORM yomiru_refresh_practice_postings(titles);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER yomiru_practice_posting_insert
AFTER INSERT ON yomiru_public_title_word REFERENCING NEW TABLE AS next_words
FOR EACH STATEMENT EXECUTE FUNCTION yomiru_on_practice_posting_change();
CREATE OR REPLACE TRIGGER yomiru_practice_posting_delete
AFTER DELETE ON yomiru_public_title_word REFERENCING OLD TABLE AS prior_words
FOR EACH STATEMENT EXECUTE FUNCTION yomiru_on_practice_posting_change();
CREATE OR REPLACE TRIGGER yomiru_practice_posting_update
AFTER UPDATE ON yomiru_public_title_word REFERENCING OLD TABLE AS prior_words NEW TABLE AS next_words
FOR EACH STATEMENT EXECUTE FUNCTION yomiru_on_practice_posting_change();
CREATE OR REPLACE TRIGGER yomiru_practice_posting_truncate
AFTER TRUNCATE ON yomiru_public_title_word
FOR EACH STATEMENT EXECUTE FUNCTION yomiru_on_practice_posting_change();

CREATE OR REPLACE FUNCTION yomiru_sync_practice_card_rank() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    UPDATE yomiru_practice_word_key SET rank_weight = NULL WHERE rank_weight IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE yomiru_practice_word_key SET rank_weight = NULL WHERE word_id = OLD.word_id;
  ELSE
    INSERT INTO yomiru_practice_word_key (word_id, rank_weight)
      VALUES (NEW.word_id, CASE WHEN NEW.lower_priority THEN 1 ELSE 4 END)
      ON CONFLICT (word_id) DO UPDATE SET rank_weight = excluded.rank_weight
      WHERE yomiru_practice_word_key.rank_weight IS DISTINCT FROM excluded.rank_weight;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER yomiru_practice_card_rank
AFTER INSERT OR DELETE OR UPDATE OF lower_priority ON yomiru_public_practice_card
FOR EACH ROW EXECUTE FUNCTION yomiru_sync_practice_card_rank();
CREATE OR REPLACE TRIGGER yomiru_practice_card_rank_truncate
AFTER TRUNCATE ON yomiru_public_practice_card
FOR EACH STATEMENT EXECUTE FUNCTION yomiru_sync_practice_card_rank();

TRUNCATE yomiru_practice_title_posting;
SELECT yomiru_refresh_practice_postings(array_agg(video_id))
FROM (SELECT DISTINCT video_id FROM yomiru_public_title_word) AS titles;

COMMIT;
