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

export interface AccumulateResult {
  /** Deduped union pruned to the current patch — persist AND aggregate this. */
  store: NormMatch[];
  /** Patch the dataset represents. */
  dominantPatch: string;
}

/**
 * Merge a fresh crawl into the prior accumulated store, keeping ONLY the
 * current patch. Balance changes make champion strength patch-specific, so
 * stats never mix patches (the same policy the major stats sites use) — when a
 * new patch ships, the store resets to it and the sample rebuilds.
 *
 * The current patch is read off the FRESH crawl (recent matches track the live
 * patch within a crawl or two of release). Judging it from the union instead
 * would let the old patch's stored volume outvote a new patch for days.
 * Fallbacks: the union's dominant patch (empty crawl), then Data Dragon's.
 *
 * Pure + deterministic so it can be unit-tested without any I/O.
 */
export function accumulate(
  prior: NormMatch[],
  fresh: NormMatch[],
  fallbackPatch: string,
): AccumulateResult {
  const byId = new Map<string, NormMatch>();
  for (const m of prior) byId.set(m.matchId, m);
  for (const m of fresh) byId.set(m.matchId, m); // fresh wins on conflict
  const union = [...byId.values()];

  const dominantPatch = topPatches(fresh, 1)[0] ?? topPatches(union, 1)[0] ?? fallbackPatch;
  const store = union.filter((m) => m.patch === dominantPatch);

  return { store, dominantPatch };
}
