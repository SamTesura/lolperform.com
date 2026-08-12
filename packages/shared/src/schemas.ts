import { z } from 'zod';
import { ROLES, RANK_BRACKETS, REGIONS, TIER_GRADES } from './constants.js';
import { FULL_TIER_GRADES } from './tier.js';

/* ------------------------------------------------------------------ *
 * Primitive enums (derived from the canonical constant tuples)
 * ------------------------------------------------------------------ */

export const roleSchema = z.enum(ROLES);
export const rankBracketSchema = z.enum(RANK_BRACKETS);
export const regionSchema = z.enum(REGIONS);
export const tierGradeSchema = z.enum(TIER_GRADES);
/** Fine sub-graded tier ("S+" … "D-") — what the pipeline stores per slice. */
export const fullTierGradeSchema = z.enum(FULL_TIER_GRADES);

/** Patch label as `major.minor`, e.g. "14.12". */
export const patchSchema = z.string().regex(/^\d{1,2}\.\d{1,2}$/, 'patch must look like "14.12"');

/** Numeric Riot champion key as a string, e.g. "21" (Miss Fortune). */
export const championKeySchema = z.string().regex(/^\d+$/, 'champion key must be numeric');

/* ------------------------------------------------------------------ *
 * Static champion metadata (from Data Dragon)
 * ------------------------------------------------------------------ */

export const championMetaSchema = z.object({
  key: championKeySchema,
  id: z.string().min(1), // alphanumeric id, e.g. "MissFortune" — used for slugs/images
  name: z.string().min(1),
  title: z.string(),
  roles: z.array(roleSchema),
});
export type ChampionMeta = z.infer<typeof championMetaSchema>;

/* ------------------------------------------------------------------ *
 * Aggregated records (output of the pipeline, source rows in D1)
 * ------------------------------------------------------------------ */

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
   * Win rate with the champion's player pool held at average strength — the
   * ranking signal. `winRate` says what happened; this estimates how much of
   * it the champion is responsible for. Null when no player-baseline
   * observations back this row yet, in which case ranking falls back to the
   * raw rate. See playerSkill.ts.
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
  /** True when the grade leans on a shrinkage-blended prior-patch prior because
   *  this champion hasn't reached TIER_LIST_MIN_GAMES yet this patch. */
  provisional: z.boolean().default(false),
  /** Win-rate change vs the previous patch, in absolute proportion (e.g. +0.012). */
  deltaWinRate: z.number().nullable().default(null),
  /** Tier movement vs the previous patch. */
  deltaTier: z.number().int().nullable().default(null),
});
export type RoleStats = z.infer<typeof roleStatsSchema>;

/**
 * Win rate of one keystone rune on one champion in one role.
 *
 * Unlike item statistics this is defensible: a rune page is locked in champion
 * select, before the game exists, so it cannot be an effect of already winning
 * the way a completed item can. It is still a *choice*, so it carries the usual
 * selection caveat, which is why the UI shows it against the champion's own
 * baseline rather than as a standalone number.
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
 *
 * The signature is keystone + primary style + secondary style, so the arms
 * stay fat; the stored page is the most common full page inside that
 * signature. Like keystones (and unlike items), a rune page is locked before
 * the game exists, so its win rate is a fair thing to publish.
 */
export const runePageStatsSchema = z.object({
  ...sliceShape,
  role: roleSchema,
  championKey: championKeySchema,
  /** 1 = most played page, 2 = second most played. */
  slot: z.number().int().min(1).max(2),
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
   * Per display-slot alternatives: for each item slot, the finished items most
   * often held at that inventory position, with each option's share of the
   * games that filled the slot and its raw count. Popularity, deliberately not
   * per-slot win rates — an item's "win rate" mostly measures having been
   * winning long enough to buy it.
   */
  slotOptions: z
    .array(z.array(z.object({ item: z.number().int(), share: z.number(), games: z.number().int() })))
    .nullable()
    .default(null),
  /** Boots ranked by popularity — their own decision, kept out of the
   *  positional slots. Same popularity-not-win-rate treatment as slots. */
  bootOptions: z
    .array(z.object({ item: z.number().int(), share: z.number(), games: z.number().int() }))
    .nullable()
    .default(null),
  /**
   * Summoner spell pairs with pick share AND win rate. Spells are locked in
   * champion select — pre-lock like runes, unlike items — so a per-pair win
   * rate is a fair number to publish.
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
});
export type BuildPath = z.infer<typeof buildPathSchema>;

/* ------------------------------------------------------------------ *
 * API response envelopes
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * API query params (validated at the Worker edge)
 * ------------------------------------------------------------------ */

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
