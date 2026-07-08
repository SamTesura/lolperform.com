-- Tier is now the fine sub-grade written by rank-percentile grading
-- ("S+" … "D-"), not just the base letter — widen the CHECK accordingly.
-- SQLite can't alter a CHECK, so rebuild the table (safe with or without rows).
ALTER TABLE role_stats RENAME TO role_stats_old;

CREATE TABLE role_stats (
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
  tier          TEXT NOT NULL CHECK (tier IN (
    'S+','S','S-','A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-'
  )),
  PRIMARY KEY (patch, region, rank, role, champion_key)
);

INSERT INTO role_stats SELECT * FROM role_stats_old;
DROP TABLE role_stats_old;

CREATE INDEX IF NOT EXISTS idx_role_stats_slice ON role_stats (patch, region, rank, role, score DESC);
CREATE INDEX IF NOT EXISTS idx_role_stats_champ ON role_stats (champion_key, patch, region, rank);
