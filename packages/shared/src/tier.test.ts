import { describe, expect, it } from 'vitest';
import { baseTier, gradeSlice, pbi, TIER_LIST_MIN_GAMES, type GradeInput } from './tier.js';

function row(winRate: number, pickRate = 0.1, banRate = 0.05, games = 5000): GradeInput {
  // wilsonLower ~ winRate for large samples; a fixed offset keeps ordering intact.
  return { winRate, pickRate, banRate, games, wilsonLower: winRate - 0.01 };
}

describe('pbi', () => {
  it('rewards contested picks and punishes low-impact ones', () => {
    const meta = pbi({ winRate: 0.54, pickRate: 0.2, banRate: 0.3 });
    const fringe = pbi({ winRate: 0.54, pickRate: 0.01, banRate: 0 });
    expect(meta).toBeGreaterThan(fringe);
  });

  it('is negative for losing champions', () => {
    expect(pbi({ winRate: 0.45, pickRate: 0.1, banRate: 0.1 })).toBeLessThan(0);
  });
});

describe('gradeSlice', () => {
  it('grades by rank percentile: best of the pool is S+, worst is D-', () => {
    // 40 champions, win rates descending at constant pick rate, so the Wilson
    // and PBI rankings agree exactly and the percentile cut is deterministic.
    const rows = Array.from({ length: 40 }, (_, i) => row(0.56 - i * 0.003, 0.15));
    const graded = gradeSlice(rows);
    expect(graded[0]!.grade).toBe('S+');
    expect(graded[39]!.grade).toBe('D-');
    // scores strictly follow the ranking
    expect(graded[0]!.score).toBeGreaterThan(graded[20]!.score);
    expect(graded[20]!.score).toBeGreaterThan(graded[39]!.score);
  });

  it('a high-WR fringe pick ranks below a contested meta pick with similar WR', () => {
    const rows = [
      row(0.545, 0.25, 0.3), // meta: high pick, high ban
      row(0.55, 0.01, 0.0), // fringe: barely played, so tiny meta influence
      // solid mid-pool picks whose PBI beats the fringe's sliver of pick rate
      ...Array.from({ length: 10 }, (_, i) => row(0.515 - i * 0.003, 0.12)),
    ];
    const graded = gradeSlice(rows);
    expect(graded[0]!.score).toBeGreaterThan(graded[1]!.score);
  });

  it('excludes champions under the games floor and marks them D- with negative score', () => {
    const rows = [row(0.52), { ...row(0.99), games: TIER_LIST_MIN_GAMES - 1 }];
    const graded = gradeSlice(rows);
    expect(graded[0]!.grade).toBe('S+'); // pool of one → top percentile
    expect(graded[1]!.grade).toBe('D-');
    expect(graded[1]!.score).toBeLessThan(0); // always sorts below ranked rows
  });

  it('returns placeholders when nothing reaches the floor', () => {
    const graded = gradeSlice([{ ...row(0.6), games: 10 }]);
    expect(graded[0]!.grade).toBe('D-');
    expect(graded[0]!.score).toBeLessThan(0);
  });

  it('result is aligned with input order, not rank order', () => {
    const rows = [row(0.45, 0.05), row(0.56, 0.2)]; // worse champion first
    const graded = gradeSlice(rows);
    expect(graded[1]!.score).toBeGreaterThan(graded[0]!.score);
  });
});

describe('baseTier', () => {
  it('is the first character of the full grade', () => {
    expect(baseTier('S+')).toBe('S');
    expect(baseTier('A-')).toBe('A');
    expect(baseTier('D-')).toBe('D');
  });
});
