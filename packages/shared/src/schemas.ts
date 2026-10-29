import { z } from 'zod';
import { ROLES, RANK_BRACKETS, REGIONS, TIER_GRADES } from './constants.js';
import { FULL_TIER_GRADES } from './tier.js';

// Primitive enums, derived from the constant tuples.

export const roleSchema = z.enum(ROLES);
export const rankBracketSchema = z.enum(RANK_BRACKETS);
export const regionSchema = z.enum(REGIONS);
export const tierGradeSchema = z.enum(TIER_GRADES);
/** Fine sub-graded tier ("S+" to "D-"), as the pipeline stores it per slice. */
export const fullTierGradeSchema = z.enum(FULL_TIER_GRADES);

/** Patch label as `major.minor`, e.g. "14.12". */
export const patchSchema = z.string().regex(/^\d{1,2}\.\d{1,2}$/, 'patch must look like "14.12"');

/** Numeric Riot champion key as a string, e.g. "21" (Miss Fortune). */
export const championKeySchema = z.string().regex(/^\d+$/, 'champion key must be numeric');

// Static champion metadata from Data Dragon.

export const championMetaSchema = z.object({
  key: championKeySchema,
  // Alphanumeric id used for slugs and images, e.g. "MissFortune".
  id: z.string().min(1),
  name: z.string().min(1),
  title: z.string(),
  roles: z.array(roleSchema),
});
export type ChampionMeta = z.infer<typeof championMetaSchema>;

// Aggregated records: pipeline output, stored as rows in D1.

/** A slice key shared by every aggregated record. */
const sliceShape = {
  patch: patchSchema,
  region: regionSchema,
  rank: rankBracketSchema,
};

/** Per-champion, per-role performance in one slice. */
export const roleStatsSchema = z.object({
  ...sliceShape,
  role: roleSchema,
  championKey: championKeySchema,
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1),
  pickRate: z.number().min(0).max(1),
  banRate: z.number().min(0).max(1),
  /** Wilson lower bound used for ranking/tiering. */
  wilsonLower: z.number().min(0).max(1),
  /**
   * Win rate with the champion's player pool held at average strength; the
   * ranking signal. Null without player-baseline observations, in which case
   * ranking falls back to the raw rate. See playerSkill.ts.
   */
  adjustedWinRate: z.number().min(0).max(1).nullable().default(null),
  /**
   * How much stronger (positive) or weaker (negative) this champion's players
   * are than the slice average, in win-rate points, after shrinkage. Published
   * for transparency: it is the whole of the adjustment above.
   */
  playerPoolDelta: z.number().nullable().default(null),
  /** Rank-derived sort score (higher = better; sub-floor rows are negative). */
  score: z.number(),
  tier: fullTierGradeSchema,
  /** True when the grade leans on prior-patch stats because this patch is
   *  still under TIER_LIST_MIN_GAMES. */
  provisional: z.boolean().default(false),
  /** Win-rate change vs the previous patch, in absolute proportion (e.g. +0.012). */
  deltaWinRate: z.number().nullable().default(null),
  /** Tier movement vs the previous patch. */
  deltaTier: z.number().int().nullable().default(null),
});
export type RoleStats = z.infer<typeof roleStatsSchema>;

/**
 * Win rate of one keystone rune on one champion in one role. Runes lock in
 * champion select, so unlike items the rate is not an effect of already
 * winning. It is still a choice, so the UI shows it against the champion's own
 * baseline.
 */
export const keystoneStatsSchema = z.object({
  ...sliceShape,
  role: roleSchema,
  championKey: championKeySchema,
  keystone: z.number().int(),
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1),
  wilsonLower: z.number().min(0).max(1),
});
export type KeystoneStats = z.infer<typeof keystoneStatsSchema>;

/**
 * One of a champion's most common rune pages, with the page's own sample.
 * Pages group by keystone + primary style + secondary style so each group keeps
 * a usable sample; the stored page is the most common full page in the group.
 */
export const runePageStatsSchema = z.object({
  ...sliceShape,
  role: roleSchema,
  championKey: championKeySchema,
  /** 1 = most played page, 2 = second most played. */
  slot: z.number().int().min(1).max(4),
  runes: z.lazy(() => runePageSchema),
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1),
  wilsonLower: z.number().min(0).max(1),
});
export type RunePageStats = z.infer<typeof runePageStatsSchema>;

/** Champion-vs-champion lane matchup (same role, opposing teams). */
export const matchupSchema = z.object({
  ...sliceShape,
  role: roleSchema,
  championKey: championKeySchema,
  opponentKey: championKeySchema,
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1),
  wilsonLower: z.number().min(0).max(1),
});
export type Matchup = z.infer<typeof matchupSchema>;

/** ADC + Support duo synergy (same team, bot lane). */
export const duoSynergySchema = z.object({
  ...sliceShape,
  adcKey: championKeySchema,
  supportKey: championKeySchema,
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1),
  wilsonLower: z.number().min(0).max(1),
});
export type DuoSynergy = z.infer<typeof duoSynergySchema>;

/** A rune setup. Ids are Riot perk/style ids. */
export const runePageSchema = z.object({
  keystone: z.number().int(),
  primaryStyle: z.number().int(),
  subStyle: z.number().int(),
  primary: z.array(z.number().int()),
  secondary: z.array(z.number().int()),
  shards: z.array(z.number().int()),
});
export type RunePage = z.infer<typeof runePageSchema>;

/** Most common winning build for a champion (optionally vs an opponent). */
export const buildPathSchema = z.object({
  ...sliceShape,
  role: roleSchema,
  championKey: championKeySchema,
  opponentKey: championKeySchema.nullable().default(null),
  /** Core item ids in completion order. */
  items: z.array(z.number().int()),
  runes: runePageSchema,
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1),
  /**
   * Per display slot, the finished items most often held there, with each
   * option's share of the games that filled the slot and its raw count.
   * Popularity, not win rate: an item's win rate mostly measures having been
   * ahead long enough to buy it.
   */
  slotOptions: z
    .array(
      z.array(z.object({ item: z.number().int(), share: z.number(), games: z.number().int() })),
    )
    .nullable()
    .default(null),
  /** Boots ranked by popularity, kept out of the positional slots because they
   *  are a separate decision. */
  bootOptions: z
    .array(z.object({ item: z.number().int(), share: z.number(), games: z.number().int() }))
    .nullable()
    .default(null),
  /**
   * Summoner spell pairs with pick share and win rate. Spells lock in champion
   * select, so a per-pair win rate is fair to publish.
   */
  spellOptions: z
    .array(
      z.object({
        spells: z.tuple([z.number().int(), z.number().int()]),
        share: z.number(),
        games: z.number().int(),
        wins: z.number().int(),
        winRate: z.number().min(0).max(1),
      }),
    )
    .nullable()
    .default(null),
  /** Build archetypes grouped by first completed item (Kraken-first vs
   *  Yun Tal-first). `items` is the group's most common three-item path; stats
   *  cover the whole group. The first item is close to a pre-outcome choice, so
   *  its win rate is publishable where per-item rates are not. */
  coreOptions: z
    .array(
      z.object({
        items: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
        share: z.number(),
        games: z.number().int(),
        wins: z.number().int(),
        winRate: z.number().min(0).max(1),
      }),
    )
    .nullable()
    .default(null),
  /** Opening buys (first 30 s, timelines sampled 1 in 5), potions included,
   *  e.g. Doran's Blade + 2 potions. Bought before the game develops, so the
   *  win rate is fair to publish. */
  startOptions: z
    .array(
      z.object({
        items: z.array(z.number().int()).min(1),
        share: z.number(),
        games: z.number().int(),
        wins: z.number().int(),
        winRate: z.number().min(0).max(1),
      }),
    )
    .nullable()
    .default(null),
});
export type BuildPath = z.infer<typeof buildPathSchema>;

// API response envelopes.

export const datasetMetaSchema = z.object({
  patch: patchSchema,
  generatedAt: z.string(), // ISO 8601
  regions: z.array(regionSchema),
  ranks: z.array(rankBracketSchema),
  totalMatches: z.number().int().nonnegative(),
});
export type DatasetMeta = z.infer<typeof datasetMetaSchema>;

export const tierListResponseSchema = z.object({
  ...sliceShape,
  role: roleSchema,
  generatedAt: z.string(),
  champions: z.array(roleStatsSchema),
});
export type TierListResponse = z.infer<typeof tierListResponseSchema>;

export const championDetailResponseSchema = z.object({
  meta: championMetaSchema,
  stats: z.array(roleStatsSchema),
  matchups: z.array(matchupSchema),
  synergies: z.array(duoSynergySchema),
  builds: z.array(buildPathSchema),
  keystones: z.array(keystoneStatsSchema).default([]),
  runePages: z.array(runePageStatsSchema).default([]),
});
export type ChampionDetailResponse = z.infer<typeof championDetailResponseSchema>;

/** A single counter-pick suggestion. */
export const counterPickSchema = z.object({
  championKey: championKeySchema,
  winRate: z.number().min(0).max(1),
  wilsonLower: z.number().min(0).max(1),
  games: z.number().int().nonnegative(),
  tier: fullTierGradeSchema,
});
export type CounterPick = z.infer<typeof counterPickSchema>;

// API query params, validated at the Worker edge.

export const tierListQuerySchema = z.object({
  region: regionSchema,
  rank: rankBracketSchema,
  role: roleSchema,
});
export type TierListQuery = z.infer<typeof tierListQuerySchema>;

export const counterQuerySchema = z.object({
  region: regionSchema,
  rank: rankBracketSchema,
  role: roleSchema,
  /** The enemy champion the user is trying to counter. */
  opponentKey: championKeySchema,
});
export type CounterQuery = z.infer<typeof counterQuerySchema>;
