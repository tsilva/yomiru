CREATE TABLE IF NOT EXISTS yomiru_subtitle_upload (
  key text PRIMARY KEY CHECK (key ~ '^library/[a-f0-9]{64}\.ass$'),
  expires_at timestamptz NOT NULL
);
