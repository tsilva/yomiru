BEGIN;

CREATE TABLE IF NOT EXISTS yomiru_practice_cue (
  source_revision text NOT NULL CHECK (source_revision ~ '^[0-9a-f]{64}$'),
  cue_id text NOT NULL CHECK (cue_id ~ '^c[0-9]{5}$'),
  hiragana text NOT NULL CHECK (char_length(hiragana) BETWEEN 1 AND 100),
  romaji text NOT NULL CHECK (char_length(romaji) BETWEEN 1 AND 160),
  PRIMARY KEY (source_revision, cue_id)
);
ALTER TABLE yomiru_practice_cue ADD COLUMN IF NOT EXISTS word_peeks jsonb
  CHECK (jsonb_typeof(word_peeks) = 'array');

CREATE TABLE IF NOT EXISTS yomiru_practice_example (
  source_revision text NOT NULL,
  cue_id text NOT NULL,
  word_id text NOT NULL,
  gloss_key text NOT NULL CHECK (gloss_key <> ''),
  hiragana_start smallint NOT NULL CHECK (hiragana_start >= 0),
  hiragana_end smallint NOT NULL CHECK (hiragana_end > hiragana_start),
  romaji_start smallint NOT NULL CHECK (romaji_start >= 0),
  romaji_end smallint NOT NULL CHECK (romaji_end > romaji_start),
  PRIMARY KEY (source_revision, word_id, gloss_key, cue_id),
  FOREIGN KEY (source_revision, cue_id) REFERENCES yomiru_practice_cue ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS yomiru_practice_context_title (
  video_id text PRIMARY KEY,
  anchor text NOT NULL CHECK (anchor ~ '^[a-f0-9]{64}$'),
  source_revision text NOT NULL CHECK (source_revision ~ '^[a-f0-9]{64}$'),
  publication text CHECK (publication ~ '^[a-f0-9]{64}$')
);
ALTER TABLE yomiru_practice_context_title ADD COLUMN IF NOT EXISTS publication text
  CHECK (publication ~ '^[a-f0-9]{64}$');

CREATE INDEX IF NOT EXISTS yomiru_practice_example_word
  ON yomiru_practice_example (word_id, gloss_key, source_revision, cue_id);

COMMIT;
