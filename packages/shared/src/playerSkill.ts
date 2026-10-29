/**
 * Player-pool correction: separates "this champion wins" from "the people who
 * pick this champion win". In bot lane, popularity and win rate correlate at
 * -0.46 inside every rank stratum because popular marksmen draw weaker players,
 * and match outcomes alone cannot tell the two apart. Each crawl seed's career
 * ranked record from league-v4 supplies the outside signal.
 *
 * As deviations from the slice mean, for champion c:
 *   w = raw win rate - 50%
 *   s = mean career win rate of c's observed players - pool mean
 *   f = share of those players' own games spent on c
 * The champion effect is theta = (w - s) / (1 - f). Only the numerator w - s is
 * applied and f is never estimated: since 0 <= f < 1 that under-corrects, in
 * the right direction, with no extra data and nothing to tune.
 *
 * Shrinkage fades the correction in as observations accumulate. With zero
 * observations it is exactly zero, so no feature flag is needed.
 */

/**
 * Observations needed before half the measured player-pool gap is applied.
 * Each observation is one distinct player, so the mean's standard error is
 * about 6 points / sqrt(count): roughly 0.4 points at 250, well under the
 * effect being corrected (about a point).
 */
export const PLAYER_POOL_SHRINKAGE = 250;

/**
 * Hard cap on the correction, in win-rate proportion. Real player-pool gaps
 * sit well inside 4 points; anything larger is a broken estimate, and a tier
 * list should not be rewritten by one.
 */
export const MAX_PLAYER_POOL_DELTA = 0.04;

export interface PlayerPoolInput {
  /** Career win rates of the players observed picking this champion. */
  baselines: readonly number[];
  /** Mean career win rate across every observation in the slice. */
  poolMean: number;
}

export interface PlayerPoolResult {
  /** Shrunk, clamped strength of this champion's player pool vs the slice. */
  delta: number;
  /** Observations behind it. */
  observations: number;
}

/**
 * Estimate how much stronger than average this champion's players are.
 * Returns a delta of exactly 0 when there is nothing to go on.
 */
export function playerPoolDelta(input: PlayerPoolInput): PlayerPoolResult {
  const n = input.baselines.length;
  if (n === 0) return { delta: 0, observations: 0 };

  const mean = input.baselines.reduce((a, b) => a + b, 0) / n;
  const raw = mean - input.poolMean;
  const shrunk = raw * (n / (n + PLAYER_POOL_SHRINKAGE));
  const clamped = Math.max(-MAX_PLAYER_POOL_DELTA, Math.min(MAX_PLAYER_POOL_DELTA, shrunk));
  return { delta: clamped, observations: n };
}

/**
 * Apply the correction to a raw win rate, clamped to a valid proportion. A
 * champion carried by strong players gives back what its players contributed,
 * and vice versa.
 */
export function adjustWinRate(winRate: number, delta: number): number {
  return Math.max(0, Math.min(1, winRate - delta));
}
