-- Widen the slot check 1-2 -> 1-4: after the two most common signatures, the
-- pipeline now emits coverage pages for any keystone strong enough for the
-- keystone list that those signatures miss (see #117). SQLite cannot alter a
-- CHECK constraint, so the table is rebuilt in place.
CREATE TABLE rune_pages_new (
  patch        TEXT NOT NULL,
  region       TEXT NOT NULL,
  rank         TEXT NOT NULL CHECK (rank IN ('emerald_plus','diamond_plus','master_plus')),
  role         TEXT NOT NULL CHECK (role IN ('TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY')),
  champion_key TEXT NOT NULL,
  slot         INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
  runes        TEXT NOT NULL,
  games        INTEGER NOT NULL,
  wins         INTEGER NOT NULL,
  win_rate     REAL NOT NULL CHECK (win_rate BETWEEN 0 AND 1),
  wilson_lower REAL NOT NULL,
  PRIMARY KEY (patch, region, rank, role, champion_key, slot)
);
INSERT INTO rune_pages_new SELECT * FROM rune_pages;
DROP TABLE rune_pages;
ALTER TABLE rune_pages_new RENAME TO rune_pages;
