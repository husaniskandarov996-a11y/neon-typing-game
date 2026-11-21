-- o'yin sessiyalari: har bir o'yin boshlanganda server seed beradi
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  seed        INTEGER NOT NULL,
  mode        TEXT NOT NULL,
  lang        TEXT NOT NULL,
  name        TEXT NOT NULL,
  ip          TEXT,
  started_at  INTEGER NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_ip_time ON sessions (ip, started_at);

-- tekshiruvdan o'tgan natijalar
CREATE TABLE IF NOT EXISTS scores (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  name_key    TEXT NOT NULL,
  mode        TEXT NOT NULL,
  lang        TEXT NOT NULL,
  score       INTEGER NOT NULL,
  words       INTEGER NOT NULL,
  wpm         INTEGER NOT NULL,
  accuracy    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scores_mode_score ON scores (mode, score DESC);
CREATE INDEX IF NOT EXISTS scores_mode_name ON scores (mode, name_key);
