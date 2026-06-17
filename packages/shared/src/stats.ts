import { SAMPLE_THRESHOLDS } from './constants.js';

/**
 * Wilson score interval lower bound for a binomial proportion.
 *
 * We rank champions by this instead of raw win rate so that a 60% win rate over
 * 10 games does not outrank a 53% win rate over 5000 games. It is the same idea
 * behind "how to sort by upvotes" — penalise small samples, reward certainty.
 *
 * @param wins  number of wins
 * @param games total games (>= wins, > 0)
 * @param z     z-score; 1.96 ≈ 95% confidence (default)
 * @returns lower bound of the win-rate interval in [0, 1]
 */
export function wilsonLowerBound(wins: number, games: number, z = 1.96): number {
  if (games <= 0) return 0;
  const phat = wins / games;
  const z2 = z * z;
  const denom = 1 + z2 / games;
  const center = phat + z2 / (2 * games);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * games)) / games);
  return Math.max(0, (center - margin) / denom);
}

export type ConfidenceLevel = 'insufficient' | 'low' | 'medium' | 'high';

/** Map a sample size to a confidence bucket for honest UI labelling. */
export function confidenceLevel(games: number): ConfidenceLevel {
  if (games < SAMPLE_THRESHOLDS.low) return 'insufficient';
  if (games < SAMPLE_THRESHOLDS.medium) return 'low';
  if (games < SAMPLE_THRESHOLDS.high) return 'medium';
  return 'high';
}

/** Round a 0..1 proportion to a percentage with fixed decimals. */
export function toPercent(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * 100 * factor) / factor;
}
