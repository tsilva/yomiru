BEGIN;

CREATE TABLE IF NOT EXISTS yomiru_publication (
  revision text PRIMARY KEY,
  snapshot bytea NOT NULL
);

CREATE TABLE IF NOT EXISTS yomiru_active (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision text REFERENCES yomiru_publication
);

INSERT INTO yomiru_active (singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS yomiru_episode (
  revision text REFERENCES yomiru_publication NOT NULL,
  id text NOT NULL,
  show_id text NOT NULL,
  ordinal int NOT NULL,
  search_text text NOT NULL,
  detail jsonb NOT NULL,
  PRIMARY KEY (revision, id),
  UNIQUE (revision, ordinal)
);

CREATE INDEX IF NOT EXISTS yomiru_episode_show ON yomiru_episode (revision, show_id, ordinal);

CREATE TABLE IF NOT EXISTS yomiru_episode_track (
  revision text REFERENCES yomiru_publication NOT NULL,
  media_type text NOT NULL,
  video_id text NOT NULL,
  ordinal int NOT NULL,
  detail jsonb NOT NULL,
  PRIMARY KEY (revision, media_type, video_id, ordinal)
);

CREATE TABLE IF NOT EXISTS yomiru_lexeme (
  revision text REFERENCES yomiru_publication NOT NULL,
  id text NOT NULL,
  detail jsonb NOT NULL,
  PRIMARY KEY (revision, id)
);

CREATE TABLE IF NOT EXISTS yomiru_episode_vocabulary (
  revision text REFERENCES yomiru_publication NOT NULL,
  episode text NOT NULL,
  header jsonb NOT NULL,
  PRIMARY KEY (revision, episode)
);

CREATE TABLE IF NOT EXISTS yomiru_episode_word (
  revision text NOT NULL,
  episode text NOT NULL,
  id text NOT NULL,
  detail jsonb NOT NULL,
  languages text[] NOT NULL,
  PRIMARY KEY (revision, episode, id),
  FOREIGN KEY (revision, episode) REFERENCES yomiru_episode_vocabulary
);

CREATE TABLE IF NOT EXISTS yomiru_compatibility_group (
  id text PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS yomiru_release (
  group_id text REFERENCES yomiru_compatibility_group,
  id text,
  detail jsonb NOT NULL,
  PRIMARY KEY (group_id, id)
);

CREATE TABLE IF NOT EXISTS yomiru_vote (
  group_id text,
  release_id text,
  voter text,
  works boolean NOT NULL,
  PRIMARY KEY (group_id, release_id, voter),
  FOREIGN KEY (group_id, release_id) REFERENCES yomiru_release
);

CREATE TABLE IF NOT EXISTS yomiru_feedback_link (
  code text PRIMARY KEY,
  detail jsonb NOT NULL
);

COMMIT;
