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
 * Platform routing values we crawl — one ranked ladder each — mapped to the
 * regional routing host match-v5 uses. Add a platform here and it becomes
 * crawlable and selectable in the UI in one step.
 */
export const PLATFORMS = ['na1', 'euw1', 'kr', 'eun1', 'br1', 'jp1', 'oc1', 'vn2'] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * Region filter values exposed to users: every crawled platform plus the pooled
 * "all" view (all regions combined). Pooling is the largest, most stable sample,
 * so it is the default — adding more platforms enriches it instead of thinning
 * each per-region slice. "all" is an aggregation bucket, never a crawl target.
 */
export const REGIONS = ['all', ...PLATFORMS] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABELS: Record<Region, string> = {
  all: 'All Regions',
  na1: 'NA',
  euw1: 'EUW',
  kr: 'KR',
  eun1: 'EUNE',
  br1: 'BR',
  jp1: 'JP',
  oc1: 'OCE',
  vn2: 'VN',
};

export type RegionalRoute = 'americas' | 'europe' | 'asia' | 'sea';

export const REGION_ROUTE: Record<Platform, RegionalRoute> = {
  na1: 'americas',
  br1: 'americas',
  euw1: 'europe',
  eun1: 'europe',
  kr: 'asia',
  jp1: 'asia',
  oc1: 'sea',
  vn2: 'sea',
};

/** Platforms sampled by the crawler. */
export const ACTIVE_REGIONS: readonly Platform[] = PLATFORMS;

/** Default UI/API region: the pooled all-regions view (biggest, steadiest sample). */
export const DEFAULT_REGION: Region = 'all';

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
