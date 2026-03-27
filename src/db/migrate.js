require('dotenv').config();
const { pool } = require('./pool');

const SQL = `
-- ── Users ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(32)  NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  avatar_url    TEXT,
  bio           TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Videos ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS videos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          VARCHAR(200) NOT NULL,
  description    TEXT,
  category       VARCHAR(50)  DEFAULT 'General',
  status         VARCHAR(20)  NOT NULL DEFAULT 'processing',
  -- 'processing' | 'ready' | 'failed'

  -- storage keys
  raw_storage_key   TEXT,
  hls_storage_key   TEXT,       -- path to master.m3u8 in S3
  thumbnail_key     TEXT,

  -- public URLs (CDN)
  hls_url        TEXT,
  thumbnail_url  TEXT,

  -- stats
  views          BIGINT  NOT NULL DEFAULT 0,
  duration_secs  INTEGER,
  size_bytes     BIGINT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_videos_user_id  ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_status   ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_category ON videos(category);
CREATE INDEX IF NOT EXISTS idx_videos_created  ON videos(created_at DESC);

-- Full-text search vector
ALTER TABLE videos ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;
CREATE INDEX IF NOT EXISTS idx_videos_fts ON videos USING GIN(search_vector);

CREATE OR REPLACE FUNCTION videos_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.category, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS videos_search_trigger ON videos;
CREATE TRIGGER videos_search_trigger
  BEFORE INSERT OR UPDATE ON videos
  FOR EACH ROW EXECUTE FUNCTION videos_search_update();

-- ── Likes ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS likes (
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, video_id)
);

-- ── Subscriptions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id)
);

-- ── Comments ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id   UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id, created_at DESC);

-- ── Updated_at trigger (shared) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS videos_updated_at ON videos;
CREATE TRIGGER videos_updated_at BEFORE UPDATE ON videos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`;

async function migrate() {
  console.log('🐘 Running migrations...');
  try {
    await pool.query(SQL);
    console.log('✅ All tables created / verified.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
