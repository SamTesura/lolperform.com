import type { NormMatch } from './riot/types.js';

/** The `n` patches the most matches are on, most common first. Data Dragon's CDN
 *  version is an unreliable proxy for the live game patch, so we read it off the
 *  data instead. */
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
 * Matches on the announced patch, accumulated in the store, that alone trigger
 * the flip regardless of share.
 *
 * The share test above turns out to be calibrated against the wrong quantity.
 * A crawl samples the recent games of randomly chosen ranked players, not
 * recent games, and plenty of those players have not played since the patch —
 * a day into 16.15 the fresh mix was 55% 16.14, 18% 16.13 and only 4.5% 16.15,
 * with two-patches-old games nearly outvoting the live patch. Waiting for a
 * fifth of the crawl would have left the site labelled with the previous patch
 * for days.
 *
 * The share gate existed to avoid flipping into an empty tier list, and that
 * reason is gone: provisional grading blends a thin current sample with the
 * prior patch, so a new patch is presentable long before it dominates. This
 * threshold is the volume at which the popular champions clear the provisional
 * floor of MIN_TIER_GAMES in their lane, which is what makes the flipped list
 * worth showing.
 */
export const MIN_TARGET_PATCH_MATCHES = 3000;

export interface AccumulateResult {
  /** Deduped union pruned to the dataset patch plus the announced (ramping)
   *  patch — persist this, but aggregate only the dominant-patch subset. */
  store: NormMatch[];
  /** Patch the dataset represents. */
  dominantPatch: string;
}

/**
 * Merge a fresh crawl into the prior accumulated store. Balance changes make
 * champion strength patch-specific, so stats never mix patches (the same
 * policy the major stats sites use) — when a new patch ships, the dataset
 * resets to it and the sample rebuilds.
 *
 * The dataset patch is read off the FRESH crawl, flipping to Data Dragon's
 * announced patch as soon as it reaches TARGET_PATCH_FLIP_SHARE of the crawl.
 * Judging from the union would let stored volume outvote a new patch for
 * days; requiring a raw crawl majority has the same problem in miniature,
 * because players' match histories keep old-patch games in every crawl.
 * Fallbacks: the fresh crawl's dominant patch, the union's (empty crawl),
 * then Data Dragon's.
 *
 * The store keeps the announced patch alongside the dominant one, so a
 * ramping patch accumulates volume in the background instead of being thrown
 * away — by the time the dataset flips, its sample already has depth.
 *
 * Pure + deterministic so it can be unit-tested without any I/O.
 */
export function accumulate(
  prior: NormMatch[],
  fresh: NormMatch[],
  targetPatch: string,
): AccumulateResult {
  const byId = new Map<string, NormMatch>();
  for (const m of prior) byId.set(m.matchId, m);
  for (const m of fresh) byId.set(m.matchId, m); // fresh wins on conflict
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
