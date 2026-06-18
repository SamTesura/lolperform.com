import type { TierGrade } from '@lolperform/shared';

/**
 * Tiering policy — deliberately simple and explainable (it's published on the
 * methodology page). A champion is tiered by its observed win rate, but only
 * once it clears a minimum game count; below that it can't earn above D, so a
 * tiny lucky sample never shows up as S.
 */
export const MIN_TIER_GAMES = 50;

/** Win-rate floors per tier, highest first. */
export const TIER_BANDS: readonly { tier: TierGrade; min: number }[] = [
  { tier: 'S', min: 0.525 },
  { tier: 'A', min: 0.515 },
  { tier: 'B', min: 0.505 },
  { tier: 'C', min: 0.49 },
];

export function assignTier(winRate: number, games: number): TierGrade {
  if (games < MIN_TIER_GAMES) return 'D';
  for (const band of TIER_BANDS) {
    if (winRate >= band.min) return band.tier;
  }
  return 'D';
}
