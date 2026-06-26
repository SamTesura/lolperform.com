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
  /** Deduped union, pruned to the kept patches — persist this back to the store. */
  store: NormMatch[];
  /** Matches to aggregate now, relabelled to the dominant patch. */
  matches: NormMatch[];
  /** Patch the dataset is tagged with (the most common one present). */
  dominantPatch: string;
  /** Second patch folded in for volume, if any. */
  priorPatch?: string;
}

/**
 * Merge a fresh crawl into the prior accumulated store so volume compounds across
 * runs without a bigger API key:
 *  - dedup by matchId (a match re-seen in a later crawl is never double-counted),
 *  - prune to the two most common recent patches (bounds the store; meta is
 *    ~stable across adjacent patches), and
 *  - relabel everything kept to the dominant patch for a single-patch dataset.
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

  const [dominantPatch = fallbackPatch, priorPatch] = topPatches(union, 2);
  const keep = new Set([dominantPatch, priorPatch].filter(Boolean) as string[]);
  const store = union.filter((m) => keep.has(m.patch));
  const matches = store.map((m) => (m.patch === dominantPatch ? m : { ...m, patch: dominantPatch }));

  return { store, matches, dominantPatch, priorPatch };
}
