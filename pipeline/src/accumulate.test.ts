import { describe, expect, it } from 'vitest';
import { accumulate, topPatches } from './accumulate.js';
import type { NormMatch } from './riot/types.js';

/** Minimal NormMatch stub — only the fields accumulate() reads. */
function m(matchId: string, patch: string): NormMatch {
  return { matchId, patch, region: 'na1', tier: 'EMERALD', bans: [], participants: [] };
}

describe('accumulate', () => {
  it('dedups by matchId, fresh winning over prior', () => {
    const prior = [m('a', '16.12'), m('b', '16.12')];
    const fresh = [m('b', '16.12'), m('c', '16.12')];
    const { store } = accumulate(prior, fresh, '16.12');
    expect(store.map((x) => x.matchId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('compounds volume across runs', () => {
    const run1 = accumulate([], [m('a', '16.12'), m('b', '16.12')], '16.12');
    const run2 = accumulate(run1.store, [m('c', '16.12'), m('d', '16.12')], '16.12');
    expect(run2.store).toHaveLength(4);
    expect(run2.matches).toHaveLength(4);
  });

  it('keeps only the two most common patches and relabels to the dominant', () => {
    const matches = [
      ...Array.from({ length: 5 }, (_, i) => m(`new${i}`, '16.12')),
      ...Array.from({ length: 3 }, (_, i) => m(`prev${i}`, '16.11')),
      m('old0', '16.10'), // third patch — pruned
    ];
    const { store, matches: out, dominantPatch, priorPatch } = accumulate([], matches, '16.12');
    expect(dominantPatch).toBe('16.12');
    expect(priorPatch).toBe('16.11');
    expect(store).toHaveLength(8); // 16.10 dropped
    expect(store.some((x) => x.patch === '16.10')).toBe(false);
    // everything aggregated is tagged as the dominant patch
    expect(out.every((x) => x.patch === '16.12')).toBe(true);
  });

  it('falls back to the given patch when there is no data', () => {
    const { dominantPatch, store } = accumulate([], [], '16.13');
    expect(dominantPatch).toBe('16.13');
    expect(store).toHaveLength(0);
  });

  it('topPatches orders by frequency', () => {
    const matches = [m('1', 'a'), m('2', 'b'), m('3', 'b'), m('4', 'c'), m('5', 'b'), m('6', 'c')];
    expect(topPatches(matches, 2)).toEqual(['b', 'c']);
  });
});
