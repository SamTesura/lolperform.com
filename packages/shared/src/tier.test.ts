import { describe, expect, it } from 'vitest';
import { baseTier, gradeSlice, presence, TIER_LIST_MIN_GAMES, type GradeInput } from './tier.js';

function row(winRate: number, pickRate = 0.1, banRate = 0.05, games = 5000): GradeInput {
  // wilsonLower ~ winRate for large samples; a fixed offset keeps ordering intact.
  return { winRate, pickRate, banRate, games, wilsonLower: winRate - 0.01 };
}

describe('presence', () => {
  it('rewards contested picks over pocket picks', () => {
    const meta = presence({ pickRate: 0.2, banRate: 0.3 });
    const fringe = presence({ pickRate: 0.01, banRate: 0 });
    expect(meta).toBeGreaterThan(fringe);
  });

  it('does not depend on win rate, so popularity cannot flip its sign', () => {
    // The defect in the old PBI term: (winRate - 0.5) * pickRate meant an
    // identical win rate scored wildly differently by popularity, and a
    // popular sub-50% champion was punished for being popular.
    const winner = presence({ pickRate: 0.15, banRate: 0.1 });
    const loser = presence({ pickRate: 0.15, banRate: 0.1 });
    expect(winner).toBe(loser);
    expect(presence({ pickRate: 0.15, banRate: 0 })).toBeGreaterThan(
      presence({ pickRate: 0.02, banRate: 0 }),
    );
  });
});

describe('gradeSlice popularity neutrality', () => {
  it('does not punish a champion for being popular at the same win rate', () => {
    // The regression this guards: under PBI these two ranked eight places
    // apart on the live data purely because of pick rate.
    const rows: GradeInput[] = [
      { winRate: 0.482, pickRate: 0.11, banRate: 0.12, games: 12000, wilsonLower: 0.473 },
      { winRate: 0.482, pickRate: 0.015, banRate: 0.0, games: 12000, wilsonLower: 0.473 },
      ...Array.from({ length: 12 }, (_, i) => row(0.53 - i * 0.004, 0.05)),
    ];
    const graded = gradeSlice(rows);
    // identical strength; the popular one may only be helped, never punished
    expect(graded[0]!.score).toBeGreaterThanOrEqual(graded[1]!.score);
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
      row(0.55, 0.01, 0.0), // fringe: barely played, so little meta presence
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

describe('gradeSlice skill floor', () => {
  it('breaks a dead-equal boundary in favor of the low-floor champion', () => {
    const rows = [
      { ...row(0.5, 0.1), skillFloor: 'high' as const },
      { ...row(0.5, 0.1), skillFloor: 'low' as const },
      ...Array.from({ length: 10 }, (_, i) => row(0.53 - i * 0.006, 0.1)),
    ];
    const graded = gradeSlice(rows);
    expect(graded[1]!.score).toBeGreaterThan(graded[0]!.score);
  });

  it('is bounded: a clearly better champion is never overtaken on ease alone', () => {
    const rows = [
      { ...row(0.53, 0.1), skillFloor: 'high' as const }, // 1pp ahead, hard
      { ...row(0.52, 0.1), skillFloor: 'low' as const }, // easy, but behind
      ...Array.from({ length: 10 }, (_, i) => row(0.5 - i * 0.005, 0.1)),
    ];
    const graded = gradeSlice(rows);
    expect(graded[0]!.score).toBeGreaterThan(graded[1]!.score);
  });

  it('no skillFloor means neutral (unchanged ordering)', () => {
    const rows = [row(0.52, 0.1), row(0.51, 0.1), row(0.5, 0.1)];
    const graded = gradeSlice(rows);
    expect(graded[0]!.score).toBeGreaterThan(graded[1]!.score);
    expect(graded[1]!.score).toBeGreaterThan(graded[2]!.score);
  });
});

describe('gradeSlice provisional (prior-patch blending)', () => {
  it('a sub-floor row with a prior patch enters the pool as provisional', () => {
    const rows: GradeInput[] = [
      ...Array.from({ length: 10 }, (_, i) => row(0.52 - i * 0.005, 0.12)),
      {
        ...row(0.55, 0.12, 0.05, 100), // only 100 games this patch
        priorPatch: { winRate: 0.55, pickRate: 0.12, banRate: 0.05, wilsonLower: 0.54 },
      },
    ];
    const graded = gradeSlice(rows);
    expect(graded[10]!.grade).not.toBe('D-');
    expect(graded[10]!.provisional).toBe(true);
    expect(graded[10]!.score).toBeGreaterThan(0);
  });

  it('a sub-floor row without a prior patch stays unranked regardless of skill floor', () => {
    const rows: GradeInput[] = [row(0.52), { ...row(0.6), games: 100 }];
    const graded = gradeSlice(rows);
    expect(graded[1]!.grade).toBe('D-');
    expect(graded[1]!.provisional).toBe(false);
    expect(graded[1]!.score).toBeLessThan(0);
  });

  it('a prior below MIN_TIER_GAMES is still too thin to blend into a grade', () => {
    const rows: GradeInput[] = [
      row(0.52),
      {
        ...row(0.9, 0.12, 0.05, 10), // 10 games — under MIN_TIER_GAMES
        priorPatch: { winRate: 0.9, pickRate: 0.12, banRate: 0.05, wilsonLower: 0.85 },
      },
    ];
    const graded = gradeSlice(rows);
    expect(graded[1]!.grade).toBe('D-');
    expect(graded[1]!.provisional).toBe(false);
  });

  it('a row past TIER_LIST_MIN_GAMES ignores its prior and is never marked provisional', () => {
    const rows: GradeInput[] = [
      ...Array.from({ length: 10 }, (_, i) => row(0.52 - i * 0.005, 0.12)),
      {
        ...row(0.55, 0.12, 0.05, TIER_LIST_MIN_GAMES),
        priorPatch: { winRate: 0.3, pickRate: 0.12, banRate: 0.05, wilsonLower: 0.25 }, // wildly different prior
      },
    ];
    const graded = gradeSlice(rows);
    expect(graded[10]!.provisional).toBe(false);
    expect(graded[10]!.grade).toBe('S+'); // ranks purely on its own current-patch stats
  });

  it('blend weight scales with current-patch games: more current games trusts the prior less', () => {
    const priorPatch = { winRate: 0.65, pickRate: 0.12, banRate: 0.05, wilsonLower: 0.6 };
    const early: GradeInput = { ...row(0.5, 0.12, 0.05, 100), priorPatch }; // mostly prior (strong)
    const later: GradeInput = { ...row(0.5, 0.12, 0.05, 900), priorPatch }; // mostly current (weak)
    const pool = Array.from({ length: 10 }, (_, i) => row(0.52 - i * 0.005, 0.12));
    const gradedEarly = gradeSlice([...pool, early]);
    const gradedLater = gradeSlice([...pool, later]);
    expect(gradedEarly[10]!.score).toBeGreaterThan(gradedLater[10]!.score);
  });
});

describe('baseTier', () => {
  it('is the first character of the full grade', () => {
    expect(baseTier('S+')).toBe('S');
    expect(baseTier('A-')).toBe('A');
    expect(baseTier('D-')).toBe('D');
  });
});
