BEGIN;

-- This schema is admin-only. Public exercise reads use the practice tables.
CREATE SCHEMA IF NOT EXISTS yomiru_subtitle_corpus;
REVOKE ALL ON SCHEMA yomiru_subtitle_corpus FROM PUBLIC;

CREATE TABLE IF NOT EXISTS yomiru_subtitle_corpus.publication (
  revision text PRIMARY KEY CHECK (revision ~ '^[a-f0-9]{64}$')
);

CREATE TABLE IF NOT EXISTS yomiru_subtitle_corpus.source (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  anchor text NOT NULL CHECK (anchor ~ '^[a-f0-9]{64}$'),
  word_ids text[] NOT NULL
);

CREATE TABLE IF NOT EXISTS yomiru_subtitle_corpus.source_cue (
  source_revision text NOT NULL REFERENCES yomiru_subtitle_corpus.source,
  cue_id text NOT NULL CHECK (cue_id ~ '^c[0-9]{5}$'),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  start_ms integer NOT NULL CHECK (start_ms >= 0),
  end_ms integer NOT NULL CHECK (end_ms > start_ms),
  japanese text NOT NULL,
  reading_source text NOT NULL,
  tokens jsonb NOT NULL CHECK (jsonb_typeof(tokens) = 'array'),
  PRIMARY KEY (source_revision, cue_id),
  UNIQUE (source_revision, ordinal)
);

CREATE TABLE IF NOT EXISTS yomiru_subtitle_corpus.title (
  publication text NOT NULL REFERENCES yomiru_subtitle_corpus.publication,
  video_id text NOT NULL,
  source_revision text NOT NULL REFERENCES yomiru_subtitle_corpus.source,
  PRIMARY KEY (publication, video_id),
  UNIQUE (publication, video_id, source_revision)
);

CREATE TABLE IF NOT EXISTS yomiru_subtitle_corpus.translation (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  source_revision text NOT NULL REFERENCES yomiru_subtitle_corpus.source,
  language text NOT NULL CHECK (language ~ '^[a-z]{3}$'),
  provenance text NOT NULL CHECK (provenance IN ('paired', 'rendered')),
  generation text NOT NULL,
  track_id text NOT NULL,
  UNIQUE (id, source_revision, language)
);

CREATE TABLE IF NOT EXISTS yomiru_subtitle_corpus.translation_cue (
  translation_id text NOT NULL REFERENCES yomiru_subtitle_corpus.translation,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  cue_id text,
  start_ms integer NOT NULL CHECK (start_ms >= 0),
  end_ms integer NOT NULL CHECK (end_ms > start_ms),
  text text NOT NULL CHECK (text <> ''),
  PRIMARY KEY (translation_id, ordinal)
);

CREATE TABLE IF NOT EXISTS yomiru_subtitle_corpus.choice (
  publication text NOT NULL,
  video_id text NOT NULL,
  source_revision text NOT NULL,
  language text NOT NULL,
  translation_id text NOT NULL,
  PRIMARY KEY (publication, video_id, language),
  FOREIGN KEY (publication, video_id, source_revision)
    REFERENCES yomiru_subtitle_corpus.title (publication, video_id, source_revision),
  FOREIGN KEY (translation_id, source_revision, language)
    REFERENCES yomiru_subtitle_corpus.translation (id, source_revision, language)
);

-- Exact published bytes are reproducible from the style header and ordered lines.
CREATE TABLE IF NOT EXISTS yomiru_subtitle_corpus.rendition (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  bytes integer NOT NULL CHECK (bytes > 0),
  header text NOT NULL,
  events text[] NOT NULL,
  CHECK (bytes = octet_length(header || array_to_string(events, E'\n')))
);

CREATE TABLE IF NOT EXISTS yomiru_subtitle_corpus.track (
  publication text NOT NULL REFERENCES yomiru_subtitle_corpus.publication,
  id text NOT NULL CHECK (id ~ '^[a-f0-9]{64}$'),
  sha256 text NOT NULL REFERENCES yomiru_subtitle_corpus.rendition,
  translation_id text REFERENCES yomiru_subtitle_corpus.translation,
  descriptor jsonb NOT NULL,
  PRIMARY KEY (publication, id)
);

COMMIT;
