-- Keystone win rates per champion, role and slice.
--
-- Deliberately NOT item or full-build win rates. A rune page is locked in
-- champion select, before any game state exists, so its win rate cannot be an
-- effect of already winning. A completed item's can: measured on our own store,
-- champion-games ending with 6 items win 53.6% versus 37.2% at 3 items, a
-- 16-point spread that every late item inherits regardless of its power. That
-- confound does not shrink with more data, which is why only runes are stored
-- here.
CREATE TABLE IF NOT EXISTS keystone_stats (
  patch        TEXT NOT NULL,
  region       TEXT NOT NULL,
  rank         TEXT NOT NULL CHECK (rank IN ('emerald_plus','diamond_plus','master_plus')),
  role         TEXT NOT NULL CHECK (role IN ('TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY')),
  champion_key TEXT NOT NULL,
  keystone     INTEGER NOT NULL,
  games        INTEGER NOT NULL,
  wins         INTEGER NOT NULL,
  win_rate     REAL NOT NULL CHECK (win_rate BETWEEN 0 AND 1),
  wilson_lower REAL NOT NULL,
  PRIMARY KEY (patch, region, rank, role, champion_key, keystone)
);

CREATE INDEX IF NOT EXISTS idx_keystone_lookup
  ON keystone_stats (patch, region, rank, champion_key);
