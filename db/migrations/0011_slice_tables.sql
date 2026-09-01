-- Slice tables: one row per (patch, region, rank, champion, role) carrying a JSON
-- payload, replacing the per-matchup / per-build / per-keystone / per-rune-page
-- fan-out rows.
--
-- Why: D1 bills per ROW written, not per byte — a 20 KB row and a 40 byte row
-- both count as one. The fan-out tables (matchups alone is ~108k rows a patch)
-- made one full refresh cost ~1M row writes once the DELETE pass, the implicit
-- rowid PK index and the secondary indexes were all counted, and the pipeline
-- refreshed four times a day against a Workers Free ceiling of 100,000 writes
-- per day. Folding the fan-out into payloads keyed by champion puts a full load
-- at ~19.4k rows.
--
-- WITHOUT ROWID is load-bearing: a rowid table keeps its composite primary key
-- in a separate unique index, which doubles every write. No secondary indexes
-- for the same reason — every access path is a primary-key prefix, or a bounded
-- scan of one (patch, region, rank) range.

-- Everything the champion page needs for one champion in one role of one slice.
-- payload: {
--   matchups:  [{ opponentKey, games, wins, winRate, wilsonLower }],
--   builds:    [{ opponentKey, items, runes, games, wins, winRate,
--                 slotOptions, bootOptions, spellOptions, coreOptions, startOptions }],
--   keystones: [{ keystone, games, wins, winRate, wilsonLower }],
--   runePages: [{ slot, runes, games, wins, winRate, wilsonLower }],
--   duos:      [{ adcKey, supportKey, games, wins, winRate, wilsonLower }]
-- }
-- Duos carry no role of their own, so they ride with the champion's BOTTOM row
-- when it is the ADC and its UTILITY row when it is the support.
--
-- champion_key precedes role in the key so the champion page (all roles for one
-- champion) is a primary-key prefix search. The counter-pick query filters on
-- role instead and scans the (patch, region, rank) range, projecting the matched
-- matchups out with json_each so only the 24 rows it keeps cross the wire.
CREATE TABLE IF NOT EXISTS champion_slice (
  patch        TEXT NOT NULL,
  region       TEXT NOT NULL,
  rank         TEXT NOT NULL CHECK (rank IN ('emerald_plus','diamond_plus','master_plus')),
  champion_key TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY')),
  payload      TEXT NOT NULL,
  -- The generated_at of the run that wrote this row. The loader prunes rows left
  -- behind by an earlier run (`loaded_at <> :run`) instead of deleting the whole
  -- patch first: a DELETE costs a row write per row, and re-inserting what was
  -- just deleted doubled the bill.
  loaded_at    TEXT NOT NULL,
  PRIMARY KEY (patch, region, rank, champion_key, role)
) WITHOUT ROWID;

-- One row per (patch, region, rank, role): the ungraded role stats for every
-- champion in that slice. Grading stays live in the Worker (it blends the prior
-- patch for provisional champions), so the tier list is two row reads instead of
-- the ~340 the old role_stats scan took.
-- payload: { stats: [{ championKey, games, wins, winRate, pickRate, banRate,
--                      wilsonLower, adjustedWinRate, playerPoolDelta, score, tier }] }
CREATE TABLE IF NOT EXISTS role_slice (
  patch     TEXT NOT NULL,
  region    TEXT NOT NULL,
  rank      TEXT NOT NULL CHECK (rank IN ('emerald_plus','diamond_plus','master_plus')),
  role      TEXT NOT NULL CHECK (role IN ('TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY')),
  payload   TEXT NOT NULL,
  loaded_at TEXT NOT NULL,
  PRIMARY KEY (patch, region, rank, role)
) WITHOUT ROWID;

-- The slice-wide duo board (/api/v1/duos), stored pre-sorted and capped at the
-- 500 rows that endpoint serves. A single champion's duos come from its
-- champion_slice rows, so nothing here has to be complete.
-- payload: { duos: [{ adcKey, supportKey, games, wins, winRate, wilsonLower }] }
CREATE TABLE IF NOT EXISTS duo_slice (
  patch     TEXT NOT NULL,
  region    TEXT NOT NULL,
  rank      TEXT NOT NULL CHECK (rank IN ('emerald_plus','diamond_plus','master_plus')),
  payload   TEXT NOT NULL,
  loaded_at TEXT NOT NULL,
  PRIMARY KEY (patch, region, rank)
) WITHOUT ROWID;
