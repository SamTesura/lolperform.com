import type { TierGrade } from './constants.js';
import { skillFloorOffset, type SkillFloor } from './skillFloor.js';

/**
 * Tiering policy — rank-based grading (published on /methodology). Tiers are
 * NOT fixed win-rate cutoffs: champions in a role are ranked by two signals —
 * Wilson-corrected win rate and PBI (pick-ban influence) — and grades are cut
 * at fixed percentiles of that ranking, so "S+" always means "top of this
 * patch's meta", the same convention the major tier lists follow.
 *
 * Per-player signals (best-player win rate / best-player Elo) are deliberately
 * out of scope: they require tracking individual players across months, and
 * this pipeline stores no player identifiers by design.
 *
 * Lives in shared so the pipeline (which computes and stores grades at slice
 * level) and every UI surface stay in agreement.
 */

/** Stats-display floor: below this we show a dash instead of a win rate. */
export const MIN_TIER_GAMES = 50;

/**
 * Grading floor: a champion enters a role's ranking pool only past this many
 * games this patch. Below it there is no grade at all — the tier list omits
 * the champion and its page shows NR — because ranking a champion off a few
 * dozen games is noise, not signal.
 */
export const TIER_LIST_MIN_GAMES = 1000;

/** Fine grades, best first. */
export const FULL_TIER_GRADES = [
  'S+', 'S', 'S-',
  'A+', 'A', 'A-',
  'B+', 'B', 'B-',
  'C+', 'C', 'C-',
  'D+', 'D', 'D-',
] as const;

export type FullTierGrade = (typeof FULL_TIER_GRADES)[number];

/**
 * Cumulative rank-percentile ceiling per grade. A champion whose combined-rank
 * percentile falls under `upTo` earns that grade — e.g. the top 4% of a role's
 * pool is S+. Shaped like the distribution the major tier lists produce: a few
 * S/S+, a broad middle, a thin tail.
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

/** Base letter of a full grade ("S+" → "S") — drives row grouping and colour. */
export function baseTier(full: FullTierGrade): TierGrade {
  return full[0] as TierGrade;
}

export interface GradeInput {
  winRate: number;
  pickRate: number;
  banRate: number;
  games: number;
  wilsonLower: number;
  /** Curated mechanical-demand bucket; undefined = neutral. See skillFloor.ts. */
  skillFloor?: SkillFloor;
}

/**
 * PBI (Pick Ban Influence): (win − tierAvg) · pick / (1 − ban).
 * High = contested, meta-defining pick. Our whole-game sampling makes the
 * slice's average win rate 0.5 by construction, so tierAvg is the constant 0.5.
 */
export function pbi(r: Pick<GradeInput, 'winRate' | 'pickRate' | 'banRate'>): number {
  return ((r.winRate - 0.5) * r.pickRate) / Math.max(1e-9, 1 - r.banRate);
}

export interface GradeResult {
  grade: FullTierGrade;
  /** Sort key, higher = better. Ranked rows land in (0, 1]; sub-floor rows are
   *  negative so they always sort after every ranked champion. */
  score: number;
}

/**
 * Grade one role's slice. Champions past TIER_LIST_MIN_GAMES are ranked twice —
 * by Wilson win rate and by PBI — then ordered by the sum of the two ranks
 * (rank-sum is scale-free, so neither signal drowns the other) and cut into
 * grades at TIER_PERCENTILES. Rows below the floor get a 'D-' placeholder that
 * no UI surfaces (the tier list omits them; pages show NR).
 *
 * Both signals see a skill-floor adjustment (±SKILL_FLOOR_OFFSET win-rate
 * equivalent): a low-floor champion's win rate is repeatable by anyone who
 * picks it, so it earns slightly more trust than the same number on a
 * mechanically demanding champion. Small by design — it nudges boundary
 * cases, never rewrites a tier.
 *
 * Result is aligned with the input order.
 */
export function gradeSlice(rows: readonly GradeInput[]): GradeResult[] {
  const out: GradeResult[] = rows.map((r) => ({ grade: 'D-', score: r.wilsonLower - 1 }));
  const pool = rows.map((r, i) => ({ i, r })).filter((x) => x.r.games >= TIER_LIST_MIN_GAMES);
  if (pool.length === 0) return out;

  const rankOf = (key: (x: (typeof pool)[number]) => number): Map<number, number> => {
    const sorted = [...pool].sort((a, b) => key(b) - key(a));
    return new Map(sorted.map((x, rank) => [x.i, rank]));
  };
  const adj = (x: (typeof pool)[number]): number => skillFloorOffset(x.r.skillFloor);
  const byWilson = rankOf((x) => x.r.wilsonLower + adj(x));
  const byPbi = rankOf((x) => pbi({ ...x.r, winRate: x.r.winRate + adj(x) }));

  const combined = [...pool].sort((a, b) => {
    const ra = byWilson.get(a.i)! + byPbi.get(a.i)!;
    const rb = byWilson.get(b.i)! + byPbi.get(b.i)!;
    return ra - rb || b.r.wilsonLower - a.r.wilsonLower;
  });

  combined.forEach((x, idx) => {
    const pct = idx / pool.length;
    const band = TIER_PERCENTILES.find((t) => pct < t.upTo)!;
    out[x.i] = { grade: band.grade, score: 1 - idx / pool.length };
  });
  return out;
}
