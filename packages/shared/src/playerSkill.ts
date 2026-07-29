/**
 * Player-pool correction — separating "this champion wins" from "the people
 * who pick this champion win".
 *
 * A champion's raw win rate is not a measurement of the champion. It is a
 * measurement of the champion *and* of whoever chose to play it, and in bot
 * lane those two are badly tangled: within a single rank, popular
 * blind-pick-friendly marksmen are picked by weaker players than niche
 * specialist picks are. Measured on the live store, champion popularity and
 * win rate correlate at -0.46 in BOTTOM (MID +0.13, TOP -0.04), and the
 * correlation survives inside every rank stratum, so it is not a rank-mix
 * artifact. Controlling for all ten champions in the match with a ridge
 * logistic regression does not shift it either — the confound is the players,
 * not the draft.
 *
 * That difference is invisible in match outcomes alone: "champion is weak" and
 * "champion's players are weak" predict exactly the same results, so no amount
 * of modelling anonymous outcomes can separate them. The pipeline resolves it
 * with an outside signal — every crawl seed arrives from league-v4 with its
 * career ranked record attached, so each match can carry one observation of
 * "a player this good picked this champion".
 *
 * ## The estimator
 *
 * Write everything as a deviation from the slice mean. For champion c let
 *   w = raw win rate - 50%              (what happened)
 *   s = mean career win rate of c's observed players - pool mean
 *   f = share of those players' own games spent on c
 * and split the raw rate into a champion effect and a player effect,
 * w = theta + p. A player's career record mixes their games on c with the
 * rest, s ~ f*w + (1 - f)*p, and eliminating p gives
 *
 *     theta = (w - s) / (1 - f)
 *
 * We deliberately use the numerator alone, `w - s`, and never estimate f.
 * Since 0 <= f < 1, that is the true correction scaled by (1 - f): an
 * *under*-correction, always in the right direction, never overshooting. It
 * needs no extra data and cannot be tuned to produce a desired answer.
 *
 * Shrinkage handles small samples: a champion with few observed players keeps
 * most of its raw rate, and the correction fades in as observations
 * accumulate. With zero observations the correction is exactly zero, so this
 * is inert until data exists rather than needing a feature flag.
 */

/**
 * Observations needed before half the measured player-pool gap is applied.
 *
 * Each observation is one distinct player, so the mean's standard error is
 * roughly their career-win-rate spread (~6 points) over the square root of the
 * count. At 250 that is ~0.4 points — comfortably under the effect being
 * corrected, which runs to about a point. The first live estimates were made
 * before observations were deduplicated per player and swung by more than a
 * point between consecutive crawls, so this is set to hold the correction back
 * until the count is genuinely large rather than nominally so.
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
 * Apply the correction to a raw win rate, keeping the result a valid
 * proportion. Subtracting is the point: a champion carried by strong players
 * gives back what its players contributed, and vice versa.
 */
export function adjustWinRate(winRate: number, delta: number): number {
  return Math.max(0, Math.min(1, winRate - delta));
}
