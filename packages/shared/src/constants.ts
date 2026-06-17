/**
 * Domain constants shared across the pipeline, the Worker API, and the web app.
 * Single source of truth so a role/region/rank string never drifts between layers.
 */

/** Riot `teamPosition` values, in canonical lane order. */
export const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;
export type Role = (typeof ROLES)[number];

/** Human-readable lane labels for the UI. */
export const ROLE_LABELS: Record<Role, string> = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'Bot',
  UTILITY: 'Support',
};

/** The two bot-lane roles, the focus of the deep wiki. */
export const BOT_LANE_ROLES = ['BOTTOM', 'UTILITY'] as const;

/** Ranked Solo/Duo queue id. The only queue we aggregate. */
export const QUEUE_RANKED_SOLO = 420;

/**
 * Rank brackets exposed to users for filtering. We crawl high elo and bucket
 * upward-inclusive ("emerald_plus" = Emerald and above).
 */
export const RANK_BRACKETS = ['emerald_plus', 'diamond_plus', 'master_plus'] as const;
export type RankBracket = (typeof RANK_BRACKETS)[number];

export const RANK_BRACKET_LABELS: Record<RankBracket, string> = {
  emerald_plus: 'Emerald+',
  diamond_plus: 'Diamond+',
  master_plus: 'Master+',
};

export const DEFAULT_RANK_BRACKET: RankBracket = 'emerald_plus';

/** League-v4 tiers we crawl, highest first. */
export const LEAGUE_TIERS = ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND', 'EMERALD'] as const;
export type LeagueTier = (typeof LEAGUE_TIERS)[number];

export const LEAGUE_DIVISIONS = ['I', 'II', 'III', 'IV'] as const;
export type LeagueDivision = (typeof LEAGUE_DIVISIONS)[number];

/** Which league tiers roll up into each user-facing bracket. */
export const BRACKET_TIERS: Record<RankBracket, readonly LeagueTier[]> = {
  emerald_plus: LEAGUE_TIERS,
  diamond_plus: ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND'],
  master_plus: ['CHALLENGER', 'GRANDMASTER', 'MASTER'],
};

/**
 * Platform routing values (one ranked ladder each) mapped to their regional
 * routing host used by match-v5. v1 samples NA + EUW; the rest are ready to enable.
 */
export const REGIONS = ['na1', 'euw1', 'kr', 'eun1', 'br1'] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABELS: Record<Region, string> = {
  na1: 'NA',
  euw1: 'EUW',
  kr: 'KR',
  eun1: 'EUNE',
  br1: 'BR',
};

export type RegionalRoute = 'americas' | 'europe' | 'asia';

export const REGION_ROUTE: Record<Region, RegionalRoute> = {
  na1: 'americas',
  br1: 'americas',
  euw1: 'europe',
  eun1: 'europe',
  kr: 'asia',
};

/** Regions sampled in v1. */
export const ACTIVE_REGIONS: readonly Region[] = ['na1', 'euw1'];

export const DEFAULT_REGION: Region = 'na1';

/** Tier grades, best first. */
export const TIER_GRADES = ['S', 'A', 'B', 'C', 'D'] as const;
export type TierGrade = (typeof TIER_GRADES)[number];

/**
 * Minimum games for a slice to be considered statistically meaningful.
 * Below LOW we hide or heavily flag the number — honesty over false precision.
 */
export const SAMPLE_THRESHOLDS = {
  low: 30,
  medium: 200,
  high: 1000,
} as const;
