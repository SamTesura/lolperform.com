-- The two most common rune pages per champion, role and slice, each with the
-- page's own sample. Signature granularity is keystone + both styles, so the
-- samples stay fat; the stored page is the most common full page inside that
-- signature. Rune pages are locked in champion select — a pre-lock statistic,
-- so unlike items the win rate here is fair to publish.
CREATE TABLE IF NOT EXISTS rune_pages (
  patch        TEXT NOT NULL,
  region       TEXT NOT NULL,
  rank         TEXT NOT NULL CHECK (rank IN ('emerald_plus','diamond_plus','master_plus')),
  role         TEXT NOT NULL CHECK (role IN ('TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY')),
  champion_key TEXT NOT NULL,
  slot         INTEGER NOT NULL CHECK (slot IN (1, 2)),
  runes        TEXT NOT NULL,
  games        INTEGER NOT NULL,
  wins         INTEGER NOT NULL,
  win_rate     REAL NOT NULL CHECK (win_rate BETWEEN 0 AND 1),
  wilson_lower REAL NOT NULL,
  PRIMARY KEY (patch, region, rank, role, champion_key, slot)
);
