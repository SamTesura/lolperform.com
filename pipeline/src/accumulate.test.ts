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

  it('compounds volume across runs within a patch', () => {
    const run1 = accumulate([], [m('a', '16.12'), m('b', '16.12')], '16.12');
    const run2 = accumulate(run1.store, [m('c', '16.12'), m('d', '16.12')], '16.12');
    expect(run2.store).toHaveLength(4);
  });

  it('keeps only the current patch — stats never mix patches', () => {
    const fresh = [
      ...Array.from({ length: 5 }, (_, i) => m(`new${i}`, '16.13')),
      ...Array.from({ length: 3 }, (_, i) => m(`hist${i}`, '16.12')), // players' recent history
    ];
    const { store, dominantPatch } = accumulate([], fresh, '16.13');
    expect(dominantPatch).toBe('16.13');
    expect(store).toHaveLength(5);
    expect(store.every((x) => x.patch === '16.13')).toBe(true);
  });

  it('resets the store when a new patch ships, even against a large old store', () => {
    // A big accumulated 16.13 store must not outvote the new patch: the current
    // patch is judged from the FRESH crawl, then the store resets to it.
    const prior = Array.from({ length: 100 }, (_, i) => m(`old${i}`, '16.13'));
    const fresh = [
      ...Array.from({ length: 30 }, (_, i) => m(`new${i}`, '16.14')),
      ...Array.from({ length: 10 }, (_, i) => m(`tail${i}`, '16.13')),
    ];
    const { store, dominantPatch } = accumulate(prior, fresh, '16.14');
    expect(dominantPatch).toBe('16.14');
    expect(store).toHaveLength(30);
    expect(store.every((x) => x.patch === '16.14')).toBe(true);
  });

  it('flips early: the announced patch wins at a fifth of the fresh crawl', () => {
    // Match histories keep old-patch games in every crawl for ~2 weeks, so a
    // raw majority would delay the rollover for days. Prior runs retained the
    // ramping patch, so the flipped dataset starts with that depth.
    const prior = [
      ...Array.from({ length: 100 }, (_, i) => m(`old${i}`, '16.13')),
      ...Array.from({ length: 15 }, (_, i) => m(`ramp${i}`, '16.14')),
    ];
    const fresh = [
      ...Array.from({ length: 8 }, (_, i) => m(`hist${i}`, '16.13')),
      ...Array.from({ length: 2 }, (_, i) => m(`new${i}`, '16.14')), // exactly 20%
    ];
    const { store, dominantPatch } = accumulate(prior, fresh, '16.14');
    expect(dominantPatch).toBe('16.14');
    expect(store).toHaveLength(17);
    expect(store.every((x) => x.patch === '16.14')).toBe(true);
  });

  it('retains the announced patch in the store before the flip', () => {
    const prior = Array.from({ length: 100 }, (_, i) => m(`old${i}`, '16.13'));
    const fresh = [
      ...Array.from({ length: 9 }, (_, i) => m(`hist${i}`, '16.13')),
      m('early', '16.14'), // 10% — below the flip threshold
    ];
    const { store, dominantPatch } = accumulate(prior, fresh, '16.14');
    expect(dominantPatch).toBe('16.13'); // dataset stays on the live majority
    expect(store.some((x) => x.patch === '16.14')).toBe(true); // but nothing is thrown away
    expect(store).toHaveLength(110);
  });

  it('falls back to the stored patch on an empty crawl (store survives)', () => {
    const prior = [m('a', '16.13'), m('b', '16.13')];
    const { store, dominantPatch } = accumulate(prior, [], '16.14');
    expect(dominantPatch).toBe('16.13');
    expect(store).toHaveLength(2);
  });

  it('falls back to the given patch when there is no data at all', () => {
    const { dominantPatch, store } = accumulate([], [], '16.15');
    expect(dominantPatch).toBe('16.15');
    expect(store).toHaveLength(0);
  });

  it('topPatches orders by frequency', () => {
    const matches = [m('1', 'a'), m('2', 'b'), m('3', 'b'), m('4', 'c'), m('5', 'b'), m('6', 'c')];
    expect(topPatches(matches, 2)).toEqual(['b', 'c']);
  });
});
