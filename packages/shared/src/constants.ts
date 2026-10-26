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

/** Ranked Solo/Duo queue id. The only queue the pipeline aggregates. */
export const QUEUE_RANKED_SOLO = 420;

/**
 * Rank brackets exposed to users for filtering. The crawl covers high elo only,
 * and brackets are upward-inclusive ("emerald_plus" = Emerald and above).
 */
export const RANK_BRACKETS = ['emerald_plus', 'diamond_plus', 'master_plus'] as const;
export type RankBracket = (typeof RANK_BRACKETS)[number];

export const RANK_BRACKET_LABELS: Record<RankBracket, string> = {
  emerald_plus: 'Emerald+',
  diamond_plus: 'Diamond+',
  master_plus: 'Master+',
};

export const DEFAULT_RANK_BRACKET: RankBracket = 'emerald_plus';

/** League-v4 tiers the crawler reads, highest first. */
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
 * Share of the ranked ladder in each crawled tier, in percent of all ranked
 * players (June 2026 solo-queue distribution, esportstales.com). Only the
 * ratios matter: aggregation post-stratifies each bracket to these, so the
 * deliberate apex oversampling (it keeps master_plus usable) does not skew
 * champions whose win rate moves with elo (Caitlyn down, Vayne up).
 */
export const TIER_POPULATION_SHARE: Record<LeagueTier, number> = {
  EMERALD: 12,
  DIAMOND: 4,
  MASTER: 0.84,
  GRANDMASTER: 0.062,
  CHALLENGER: 0.025,
};

/**
 * Ranked players per crawled server, in millions (Split 2 2024 ranked-API
 * estimates from unrankedsmurfs.com; VN and JP have no published figures and
 * are estimated). Only the ratios matter: the pooled "all" view post-stratifies
 * to these. The crawl budget is equal per region, so without it JP + OCE + VN
 * carry about twice their real share and skew region-sensitive champions.
 */
export const REGION_POPULATION_SHARE: Record<Platform, number> = {
  kr: 2.57,
  euw1: 2.31,
  vn2: 1.8,
  na1: 1.08,
  eun1: 1.04,
  br1: 0.87,
  jp1: 0.3,
  oc1: 0.13,
};

/**
 * Crawled platform routing values, one ranked ladder each. A platform added
 * here becomes crawlable and selectable in the UI.
 */
export const PLATFORMS = ['na1', 'euw1', 'kr', 'eun1', 'br1', 'jp1', 'oc1', 'vn2'] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * Region filter values: every crawled platform plus the pooled "all" view.
 * "all" is the default because it is the largest, most stable sample. It is an
 * aggregation bucket, never a crawl target.
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

/** Regional routing host match-v5 uses for each platform. */
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
 * Sample-size bands for confidence labels, in games. Below `low` the UI hides
 * or flags the number rather than imply false precision.
 */
export const SAMPLE_THRESHOLDS = {
  low: 30,
  medium: 200,
  high: 1000,
} as const;
