-- MasGames D1 schema

-- Saved / shared / library decks
CREATE TABLE IF NOT EXISTS decks (
  id         TEXT PRIMARY KEY,      -- short share id
  title      TEXT NOT NULL,
  cards      TEXT NOT NULL,         -- JSON array of cards
  owner      TEXT NOT NULL,         -- anonymous device id
  is_public  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL       -- ms epoch
);
CREATE INDEX IF NOT EXISTS idx_decks_owner  ON decks(owner);
CREATE INDEX IF NOT EXISTS idx_decks_public ON decks(is_public, created_at);

-- Live game sessions (standalone multiplayer)
CREATE TABLE IF NOT EXISTS sessions (
  code       TEXT PRIMARY KEY,      -- short join code
  host       TEXT NOT NULL,         -- host device id
  game       TEXT NOT NULL,         -- gutterhead | articulate | scattergories | ...
  deck       TEXT NOT NULL,         -- JSON array of cards
  state      TEXT NOT NULL,         -- JSON game state blob (has integer .rev for CAS)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Per-player data for a session (join info, submissions, drawing strokes).
-- Keyed so each player only ever writes their own rows (no clobbering).
CREATE TABLE IF NOT EXISTS entries (
  code       TEXT NOT NULL,
  player     TEXT NOT NULL,
  kind       TEXT NOT NULL,         -- player | submission | draw | action
  data       TEXT NOT NULL,         -- JSON
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (code, player, kind)
);
CREATE INDEX IF NOT EXISTS idx_entries_code ON entries(code);
