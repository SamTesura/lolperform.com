import type { TierGrade } from './constants.js';

/**
 * Tiering policy — deliberately simple and explainable (published on /methodology).
 * A champion is graded by its observed win rate on a fine S+ … D− scale, but only
 * once it clears a minimum game count. Below that it is "Unranked" (not graded at
 * all) rather than dumped into D−, so a tiny lucky/unlucky sample never shows up
 * as a real grade — and a 100%-win-rate / 40-game champion isn't mislabelled D−.
 *
 * Lives in shared so the pipeline (which stores the base letter) and the UI
 * (which derives the +/− sub-grade from the same win rate) never disagree.
 *
 * The floor is intentionally provisional (a sampled site building volume), not
 * the tens-of-thousands a full-ladder site uses. Sample size is shown on every
 * tile, so a 60-game grade is visibly less trustworthy than a 6,000-game one.
 */
export const MIN_TIER_GAMES = 50;

/**
 * Minimum games before a champion is *listed on the tier list*. Much higher than
 * the grading floor: the tier list is a ranking, and ranking a champion off a
 * few dozen games is noise, not signal. Champions below this are omitted from the
 * tier list entirely (not shown as "Unranked") until they accumulate enough. The
 * per-champion page still grades anything past MIN_TIER_GAMES, with its sample
 * size on show.
 */
export const TIER_LIST_MIN_GAMES = 1000;

/**
 * Fine-grained win-rate floors, highest first. Base letter = first character.
 * Calibrated to the real ranked win-rate distribution: champions cluster around
 * 50%, the strongest sit ~52–53%, so S+ starts at 53.5% rather than an
 * unreachable 55%. Centered on 50% = B/A boundary.
 */
export const FULL_TIER_BANDS = [
  { grade: 'S+', min: 0.535 },
  { grade: 'S', min: 0.525 },
  { grade: 'S-', min: 0.515 },
  { grade: 'A+', min: 0.51 },
  { grade: 'A', min: 0.505 },
  { grade: 'A-', min: 0.5 },
  { grade: 'B+', min: 0.495 },
  { grade: 'B', min: 0.49 },
  { grade: 'B-', min: 0.485 },
  { grade: 'C+', min: 0.48 },
  { grade: 'C', min: 0.47 },
  { grade: 'C-', min: 0.46 },
  { grade: 'D+', min: 0.45 },
  { grade: 'D', min: 0.44 },
  { grade: 'D-', min: Number.NEGATIVE_INFINITY },
] as const;

export type FullTierGrade = (typeof FULL_TIER_BANDS)[number]['grade'];

/** Whether a champion has enough games to earn a real tier (else "Unranked"). */
export function isRanked(games: number): boolean {
  return games >= MIN_TIER_GAMES;
}

/** Full sub-graded tier, e.g. "S+". Low-sample champions are capped at D−. */
export function assignFullTier(winRate: number, games: number): FullTierGrade {
  if (games < MIN_TIER_GAMES) return 'D-';
  for (const band of FULL_TIER_BANDS) {
    if (winRate >= band.min) return band.grade;
  }
  return 'D-';
}

/** Base letter of a full grade ("S+" → "S"). */
export function baseTier(full: FullTierGrade): TierGrade {
  return full[0] as TierGrade;
}

/** Base tier letter (what the pipeline stores / the grid groups + colours by). */
export function assignTier(winRate: number, games: number): TierGrade {
  return baseTier(assignFullTier(winRate, games));
}
