import type { NormMatch } from './riot/types.js';

/** The `n` patches the most matches are on, most common first. Data Dragon's CDN
 *  version is an unreliable proxy for the live game patch, so the patch is read
 *  off the data instead. */
export function topPatches(matches: NormMatch[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const m of matches) counts.set(m.patch, (counts.get(m.patch) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([patch]) => patch);
}

/**
 * Share of the fresh crawl that must already be on Data Dragon's announced
 * patch before the dataset flips to it. Player match histories reach back
 * ~2 weeks, so a fresh crawl stays majority-old-patch for days after a
 * release; a fifth of a crawl on the announced patch means the live game
 * has moved, so waiting for a raw majority only delays the rollover.
 */
export const TARGET_PATCH_FLIP_SHARE = 0.2;

/**
 * Matches on the announced patch, accumulated in the store, that trigger the
 * flip regardless of share. A crawl samples the recent games of random ranked
 * players, many of whom have not played since the patch: a day into 16.15 the
 * fresh mix was only 4.5% 16.15. Provisional grading makes a thin new patch
 * presentable, and at this volume popular champions clear MIN_TIER_GAMES.
 */
export const MIN_TARGET_PATCH_MATCHES = 3000;

export interface AccumulateResult {
  /** Deduped union pruned to the dataset patch plus the announced (ramping)
   *  patch. Persist all of it; aggregate only the dominant-patch subset. */
  store: NormMatch[];
  /** Patch the dataset represents. */
  dominantPatch: string;
}

/**
 * Merge a fresh crawl into the prior accumulated store. Balance changes make
 * champion strength patch-specific, so stats never mix patches.
 *
 * The dataset flips to Data Dragon's announced patch once it reaches
 * TARGET_PATCH_FLIP_SHARE of the fresh crawl or MIN_TARGET_PATCH_MATCHES in the
 * store; judging from the union alone would let stored volume outvote a new
 * patch for days. Otherwise it falls back to the fresh crawl's dominant patch,
 * then the union's, then Data Dragon's. The store also keeps the announced
 * patch, so its sample has depth by the time the dataset flips. Pure, no I/O.
 */
export function accumulate(
  prior: NormMatch[],
  fresh: NormMatch[],
  targetPatch: string,
): AccumulateResult {
  const byId = new Map<string, NormMatch>();
  for (const m of prior) byId.set(m.matchId, m);
  // Fresh wins on conflict.
  for (const m of fresh) byId.set(m.matchId, m);
  const union = [...byId.values()];

  // Flip on either signal: the announced patch taking a real share of this
  // crawl (the live game has clearly moved), or enough of it banked to fill a
  // list on its own (adoption is slower than the crawl can see).
  const freshShare =
    fresh.length > 0 ? fresh.filter((m) => m.patch === targetPatch).length / fresh.length : 0;
  const banked = union.filter((m) => m.patch === targetPatch).length;
  const flip = freshShare >= TARGET_PATCH_FLIP_SHARE || banked >= MIN_TARGET_PATCH_MATCHES;
  const dominantPatch = flip
    ? targetPatch
    : (topPatches(fresh, 1)[0] ?? topPatches(union, 1)[0] ?? targetPatch);

  const keep = new Set([dominantPatch, targetPatch]);
  const store = union.filter((m) => keep.has(m.patch));

  return { store, dominantPatch };
}
