-- lolperform.com — D1 (SQLite) schema.
-- One row per aggregated slice. Patches accumulate (history of record) so the
-- API can compute patch-over-patch deltas. Every write from the pipeline is an
-- idempotent INSERT OR REPLACE keyed on the slice tuple.
-- CHECK constraints mirror the Zod enums in packages/shared as a defense-in-depth
-- layer at the storage boundary.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Dataset provenance: one row per processed patch.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patches (
  patch         TEXT PRIMARY KEY,           -- "16.12"
  version       TEXT NOT NULL,              -- ddragon "16.12.1"
  generated_at  TEXT NOT NULL,             -- ISO 8601
  total_matches INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Champion metadata (current version; overwritten each run).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS champions (
  champion_key TEXT PRIMARY KEY,            -- numeric key, e.g. "51"
  id           TEXT NOT NULL,               -- "Caitlyn"
  name         TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  version      TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Per champion/role performance in a slice.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_stats (
  patch         TEXT NOT NULL,
  region        TEXT NOT NULL,
  rank          TEXT NOT NULL CHECK (rank IN ('emerald_plus','diamond_plus','master_plus')),
  role          TEXT NOT NULL CHECK (role IN ('TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY')),
  champion_key  TEXT NOT NULL,
  games         INTEGER NOT NULL,
  wins          INTEGER NOT NULL,
  win_rate      REAL NOT NULL CHECK (win_rate BETWEEN 0 AND 1),
  pick_rate     REAL NOT NULL,
  ban_rate      REAL NOT NULL,
  wilson_lower  REAL NOT NULL,
  score         REAL NOT NULL,
  tier          TEXT NOT NULL CHECK (tier IN ('S','A','B','C','D')),
  PRIMARY KEY (patch, region, rank, role, champion_key)
);

CREATE INDEX IF NOT EXISTS idx_role_stats_slice ON role_stats (patch, region, rank, role, score DESC);
CREATE INDEX IF NOT EXISTS idx_role_stats_champ ON role_stats (champion_key, patch, region, rank);

-- ---------------------------------------------------------------------------
-- Champion-vs-champion lane matchups (both directions stored).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matchups (
  patch        TEXT NOT NULL,
  region       TEXT NOT NULL,
  rank         TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY')),
  champion_key TEXT NOT NULL,
  opponent_key TEXT NOT NULL,
  games        INTEGER NOT NULL,
  wins         INTEGER NOT NULL,
  win_rate     REAL NOT NULL CHECK (win_rate BETWEEN 0 AND 1),
  wilson_lower REAL NOT NULL,
  PRIMARY KEY (patch, region, rank, role, champion_key, opponent_key)
);

-- champion's own matchup list:
CREATE INDEX IF NOT EXISTS idx_matchups_champ ON matchups (patch, region, rank, role, champion_key);
-- counter-pick lookup ("who beats opponent X in role"):
CREATE INDEX IF NOT EXISTS idx_matchups_opponent ON matchups (patch, region, rank, role, opponent_key);

-- ---------------------------------------------------------------------------
-- ADC + Support duo synergy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS duos (
  patch       TEXT NOT NULL,
  region      TEXT NOT NULL,
  rank        TEXT NOT NULL,
  adc_key     TEXT NOT NULL,
  support_key TEXT NOT NULL,
  games       INTEGER NOT NULL,
  wins        INTEGER NOT NULL,
  win_rate    REAL NOT NULL CHECK (win_rate BETWEEN 0 AND 1),
  wilson_lower REAL NOT NULL,
  PRIMARY KEY (patch, region, rank, adc_key, support_key)
);

CREATE INDEX IF NOT EXISTS idx_duos_adc ON duos (patch, region, rank, adc_key);
CREATE INDEX IF NOT EXISTS idx_duos_support ON duos (patch, region, rank, support_key);

-- ---------------------------------------------------------------------------
-- Most-common build (items + runes) per champion/role, optionally vs opponent.
-- opponent_key uses '-' for the champion-level (no-opponent) build so it can sit
-- in the primary key (SQLite treats NULLs in a PK as distinct).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS builds (
  patch        TEXT NOT NULL,
  region       TEXT NOT NULL,
  rank         TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY')),
  champion_key TEXT NOT NULL,
  opponent_key TEXT NOT NULL DEFAULT '-',
  items        TEXT NOT NULL,               -- JSON array of item ids
  runes        TEXT NOT NULL,               -- JSON RunePage
  games        INTEGER NOT NULL,
  wins         INTEGER NOT NULL,
  win_rate     REAL NOT NULL CHECK (win_rate BETWEEN 0 AND 1),
  PRIMARY KEY (patch, region, rank, role, champion_key, opponent_key)
);

CREATE INDEX IF NOT EXISTS idx_builds_champ ON builds (patch, region, rank, role, champion_key);
