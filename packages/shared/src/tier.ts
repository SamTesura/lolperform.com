import type { TierGrade } from './constants.js';
import { skillFloorOffset, type SkillFloor } from './skillFloor.js';

/**
 * Tiering policy, published on /methodology. Tiers are not win-rate cutoffs:
 * champions in a role are ranked by strength (Wilson win rate, corrected for
 * player pool) and meta presence, and grades are cut at fixed percentiles of
 * that ranking, so "S+" means "top of this patch's meta".
 *
 * The pipeline stores no player identifiers by design. The one player signal,
 * the picking player's career win rate, is aggregated per match with no
 * identity attached. See playerSkill.ts.
 */

/** Stats-display floor in games: below it the UI shows a dash instead of a win rate. */
export const MIN_TIER_GAMES = 50;

/**
 * Grading floor in games this patch. Below it there is no grade (the tier list
 * omits the champion and its page shows NR), because a few dozen games is noise.
 */
export const TIER_LIST_MIN_GAMES = 1000;

/** Fine grades, best first. */
export const FULL_TIER_GRADES = [
  'S+',
  'S',
  'S-',
  'A+',
  'A',
  'A-',
  'B+',
  'B',
  'B-',
  'C+',
  'C',
  'C-',
  'D+',
  'D',
  'D-',
] as const;

export type FullTierGrade = (typeof FULL_TIER_GRADES)[number];

/**
 * Cumulative rank-percentile ceiling per grade. A champion whose combined-rank
 * percentile falls under `upTo` earns that grade: the top 4% of a role's pool
 * is S+. Shaped like the major tier lists: a few S/S+, a broad middle, a thin
 * tail.
 */
export const TIER_PERCENTILES: readonly { grade: FullTierGrade; upTo: number }[] = [
  { grade: 'S+', upTo: 0.04 },
  { grade: 'S', upTo: 0.09 },
  { grade: 'S-', upTo: 0.14 },
  { grade: 'A+', upTo: 0.21 },
  { grade: 'A', upTo: 0.28 },
  { grade: 'A-', upTo: 0.36 },
  { grade: 'B+', upTo: 0.45 },
  { grade: 'B', upTo: 0.55 },
  { grade: 'B-', upTo: 0.64 },
  { grade: 'C+', upTo: 0.73 },
  { grade: 'C', upTo: 0.81 },
  { grade: 'C-', upTo: 0.88 },
  { grade: 'D+', upTo: 0.93 },
  { grade: 'D', upTo: 0.97 },
  { grade: 'D-', upTo: 1.01 },
] as const;

/** Whether a champion has enough games for its stats to be displayed. */
export function isRanked(games: number): boolean {
  return games >= MIN_TIER_GAMES;
}

/** Base letter of a full grade ("S+" → "S"), used for row grouping and colour. */
export function baseTier(full: FullTierGrade): TierGrade {
  return full[0] as TierGrade;
}

/** Same champion's fully-graded prior-patch stats, for provisional early grading. */
export interface PriorPatchStats {
  winRate: number;
  pickRate: number;
  banRate: number;
  wilsonLower: number;
  /** Games behind the prior. A prior is usable only if it was itself ranked
   *  (see gradeSlice); absent counts as unranked, so no provisional grade. */
  games?: number;
}

export interface GradeInput {
  winRate: number;
  /** Player-pool-corrected win rate; when set it replaces `winRate` as the
   *  ranking signal. See playerSkill.ts. */
  adjustedWinRate?: number | null;
  pickRate: number;
  banRate: number;
  games: number;
  wilsonLower: number;
  /** Curated mechanical-demand bucket; undefined = neutral. See skillFloor.ts. */
  skillFloor?: SkillFloor;
  /** Prior-patch counterpart, when this patch hasn't reached TIER_LIST_MIN_GAMES yet. */
  priorPatch?: PriorPatchStats;
}

/**
 * Meta presence: how much of the draft a champion occupies, picked or banned.
 * A contested champion is more meta-relevant and faces prepared opponents.
 * PBI, (winRate - 0.5) * pick / (1 - ban), is not used: popularity amplifies
 * its sign, so identical win rates rank far apart by pick rate alone.
 */
export function presence(r: Pick<GradeInput, 'pickRate' | 'banRate'>): number {
  return r.pickRate + r.banRate;
}

/**
 * Rank-sum weights. Strength leads, but a champion contested in a third of
 * drafts shapes the patch. On live bot lane, 2:1 lifts heavily contested picks
 * about a band over 3:1 without disturbing the top of the table.
 */
export const STRENGTH_WEIGHT = 2;
export const PRESENCE_WEIGHT = 1;

export interface GradeResult {
  grade: FullTierGrade;
  /** Sort key, higher = better. Ranked rows land in (0, 1]; sub-floor rows are
   *  negative so they always sort after every ranked champion. */
  score: number;
  /** True when this patch is still under TIER_LIST_MIN_GAMES and the grade
   *  leans on blended prior-patch stats. */
  provisional: boolean;
}

/**
 * Blend a row's stats toward its prior-patch counterpart, weighted linearly by
 * how far this patch has filled TIER_LIST_MIN_GAMES (0 games = pure prior, the
 * floor or more = pure current). Without a prior, stats pass through unchanged.
 */
function blendWithPrior(r: GradeInput, prior: PriorPatchStats | undefined): PriorPatchStats {
  if (!prior || r.games >= TIER_LIST_MIN_GAMES) {
    return {
      winRate: r.winRate,
      pickRate: r.pickRate,
      banRate: r.banRate,
      wilsonLower: r.wilsonLower,
    };
  }
  const w = r.games / TIER_LIST_MIN_GAMES;
  const p = prior;
  return {
    winRate: r.winRate * w + p.winRate * (1 - w),
    pickRate: r.pickRate * w + p.pickRate * (1 - w),
    banRate: r.banRate * w + p.banRate * (1 - w),
    wilsonLower: r.wilsonLower * w + p.wilsonLower * (1 - w),
  };
}

/**
 * Grade one role's slice. Champions past TIER_LIST_MIN_GAMES are ranked by
 * strength (Wilson bound plus player-pool and skill-floor shifts) and by meta
 * presence, ordered by a weighted rank sum (scale-free, so neither signal
 * drowns the other) and cut at TIER_PERCENTILES. A row under the floor with a
 * ranked prior enters past MIN_TIER_GAMES on blended stats, flagged
 * `provisional`; other sub-floor rows get a 'D-' placeholder no UI shows.
 * Results align with the input order.
 */
export function gradeSlice(rows: readonly GradeInput[]): GradeResult[] {
  const out: GradeResult[] = rows.map((r) => ({
    grade: 'D-',
    score: r.wilsonLower - 1,
    provisional: false,
  }));
  // Lean on a prior only if the prior itself was ranked. Otherwise a champion
  // nobody plays in the lane enters on 50 games and borrows a prior built from
  // equally few. On live 16.14 bot lane this gate cut the pool from 95 to 45.
  const usablePrior = (r: GradeInput): PriorPatchStats | undefined =>
    r.priorPatch && (r.priorPatch.games ?? 0) >= TIER_LIST_MIN_GAMES ? r.priorPatch : undefined;
  const pool = rows
    .map((r, i) => ({ i, r }))
    .filter(
      (x) => x.r.games >= TIER_LIST_MIN_GAMES || (usablePrior(x.r) && x.r.games >= MIN_TIER_GAMES),
    );
  if (pool.length === 0) return out;

  const blended = new Map(pool.map((x) => [x.i, blendWithPrior(x.r, usablePrior(x.r))]));
  // Midranks: tied values share the average of the positions they span, so a
  // signal that cannot tell two champions apart contributes nothing to
  // separating them. Arbitrary consecutive ranks would let sort order alone
  // move a champion by whole grades, and presence ties constantly (zero bans).
  const rankOf = (key: (x: (typeof pool)[number]) => number): Map<number, number> => {
    const sorted = [...pool].sort((a, b) => key(b) - key(a));
    const ranks = new Map<number, number>();
    for (let i = 0; i < sorted.length;) {
      let j = i;
      while (j + 1 < sorted.length && key(sorted[j + 1]!) === key(sorted[i]!)) j++;
      const mid = (i + j) / 2;
      for (let k = i; k <= j; k++) ranks.set(sorted[k]!.i, mid);
      i = j + 1;
    }
    return ranks;
  };
  const adj = (x: (typeof pool)[number]): number => skillFloorOffset(x.r.skillFloor);
  // Player-pool correction as a shift on the Wilson bound. The bound's *width*
  // encodes sample size, which is unaffected by who was holding the champion,
  // so shift it rather than recompute it. Zero when unmeasured.
  const poolShift = (x: (typeof pool)[number]): number =>
    x.r.adjustedWinRate === null || x.r.adjustedWinRate === undefined
      ? 0
      : x.r.adjustedWinRate - x.r.winRate;
  const byStrength = rankOf((x) => blended.get(x.i)!.wilsonLower + poolShift(x) + adj(x));
  const byPresence = rankOf((x) => presence(blended.get(x.i)!));

  const combined = [...pool].sort((a, b) => {
    const weigh = (i: number): number =>
      STRENGTH_WEIGHT * byStrength.get(i)! + PRESENCE_WEIGHT * byPresence.get(i)!;
    return weigh(a.i) - weigh(b.i) || blended.get(b.i)!.wilsonLower - blended.get(a.i)!.wilsonLower;
  });

  combined.forEach((x, idx) => {
    const pct = idx / pool.length;
    const band = TIER_PERCENTILES.find((t) => pct < t.upTo)!;
    out[x.i] = {
      grade: band.grade,
      score: 1 - idx / pool.length,
      provisional: x.r.games < TIER_LIST_MIN_GAMES,
    };
  });
  return out;
}
