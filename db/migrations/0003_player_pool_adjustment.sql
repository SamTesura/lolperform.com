-- Player-pool correction (see packages/shared/src/playerSkill.ts).
--
-- A champion's raw win rate measures the champion and its players together.
-- Within one rank, popular simple champions are picked by weaker players than
-- niche specialist picks, which is why bot-lane popularity and win rate
-- correlate at -0.46 on the live store. Each crawled match now carries one
-- observation of "a player with this career win rate picked this champion",
-- from the seed's league-v4 record, and aggregation turns those into a
-- per-champion player-pool strength.
--
-- adjusted_win_rate is the ranking signal; win_rate stays exactly what
-- happened. Both are nullable: rows aggregated before any observations exist
-- fall back to raw-rate ranking.
ALTER TABLE role_stats ADD COLUMN adjusted_win_rate REAL;
ALTER TABLE role_stats ADD COLUMN player_pool_delta REAL;
