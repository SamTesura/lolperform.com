import { describe, expect, it } from 'vitest';
import { RANK_BRACKETS } from '@lolperform/shared';
import { aggregate } from './aggregate.js';
import { botLaneMatches } from './__fixtures__/matches.js';

describe('aggregate post-stratification', () => {
  it('weights slice stats to the real rank distribution, not the crawl mix', () => {
    // Crawl mix: 200 EMERALD matches (Caitlyn 60% WR) + 600 MASTER matches
    // (Caitlyn 45% WR) — raw mix would say 48.75%. The real Emerald+ ladder is
    // ~93% Emerald+Diamond, so the weighted rate must land near the Emerald
    // stratum, far above the raw apex-dragged figure.
    const emerald = botLaneMatches(200, 120).map((m, i) => ({
      ...m,
      matchId: `em_${i}`,
      tier: 'EMERALD' as const,
    }));
    const master = botLaneMatches(600, 270).map((m, i) => ({
      ...m,
      matchId: `ma_${i}`,
      tier: 'MASTER' as const,
    }));
    const result = aggregate([...emerald, ...master]);
    const cait = result.roleStats.find(
      (r) => r.championKey === '51' && r.role === 'BOTTOM' && r.rank === 'emerald_plus',
    )!;
    // untrimmed share-weighting says ≈0.590; the MASTER cell's tiny target
    // hits the 0.25 weight floor, which pulls the blend to ≈0.575
    expect(cait.winRate).toBeGreaterThan(0.56);
    expect(cait.winRate).toBeLessThan(0.6);
    // raw sample counts stay honest
    expect(cait.games).toBe(800);
    expect(cait.wins).toBe(390);
    // master_plus bracket sees only the MASTER stratum → raw rate there
    const caitMaster = result.roleStats.find(
      (r) => r.championKey === '51' && r.role === 'BOTTOM' && r.rank === 'master_plus',
    )!;
    expect(caitMaster.winRate).toBeCloseTo(0.45, 5);
  });

  it('pooled "all" weights regions by population; per-region slices do not', () => {
    // kr (2.57M ranked) 100 matches at 60% vs oc1 (0.13M) 300 matches at 40%:
    // equal-budget pooling would say 45%; population weighting must sit near
    // the kr figure. The oc1-only slice still reports its own raw rate.
    const kr = botLaneMatches(100, 60, 'kr').map((m, i) => ({ ...m, matchId: `kr_${i}` }));
    const oce = botLaneMatches(300, 120, 'oc1').map((m, i) => ({ ...m, matchId: `oc_${i}` }));
    const result = aggregate([...kr, ...oce]);
    const pooled = result.roleStats.find(
      (r) => r.championKey === '51' && r.role === 'BOTTOM' && r.rank === 'emerald_plus' && r.region === 'all',
    )!;
    // untrimmed share-weighting says ≈0.590; the oc1 cell clamps at the 0.25
    // weight floor, landing ≈0.567 — still far from the raw-mix 0.45
    expect(pooled.winRate).toBeGreaterThan(0.55);
    expect(pooled.winRate).toBeLessThan(0.61);
    const oceOnly = result.roleStats.find(
      (r) => r.championKey === '51' && r.role === 'BOTTOM' && r.rank === 'emerald_plus' && r.region === 'oc1',
    )!;
    expect(oceOnly.winRate).toBeCloseTo(0.4, 5);
  });

  it('a single-tier slice renormalizes to weight 1 (rates equal raw)', () => {
    const result = aggregate(botLaneMatches(1250, 750));
    const cait = result.roleStats.find(
      (r) => r.championKey === '51' && r.role === 'BOTTOM' && r.rank === 'emerald_plus',
    )!;
    expect(cait.winRate).toBeCloseTo(0.6, 10);
    expect(cait.pickRate).toBeCloseTo(1, 10);
  });
});

describe('aggregate', () => {
  const matches = botLaneMatches(1250, 750); // Caitlyn bot wins 750/1250 = 60% (>= tier-list floor)

  it('computes per-role win/pick rates and rank-based tiers', () => {
    const result = aggregate(matches);
    const cait = result.roleStats.filter(
      (r) => r.championKey === '51' && r.role === 'BOTTOM' && r.rank === 'emerald_plus',
    );
    expect(cait).toHaveLength(1);
    const c = cait[0]!;
    expect(c.games).toBe(1250);
    expect(c.wins).toBe(750);
    expect(c.winRate).toBeCloseTo(0.6, 5);
    expect(c.pickRate).toBeCloseTo(1, 5); // present in every game on team 100
    expect(c.tier).toBe('S+'); // top of the bot-lane ranking pool
    expect(c.wilsonLower).toBeLessThan(c.winRate);
    // the losing side of the pool grades below the winner
    const jhin = result.roleStats.find(
      (r) => r.championKey === '202' && r.role === 'BOTTOM' && r.rank === 'emerald_plus',
    )!;
    expect(c.score).toBeGreaterThan(jhin.score);
    expect(jhin.tier).not.toBe('S+');
  });

  it('emits each cumulative rank bracket for a Challenger-seeded slice', () => {
    const result = aggregate(matches);
    const brackets = new Set(
      result.roleStats.filter((r) => r.championKey === '51' && r.role === 'BOTTOM').map((r) => r.rank),
    );
    expect(brackets).toEqual(new Set(RANK_BRACKETS));
  });

  it('records the lane matchup both directions', () => {
    const result = aggregate(matches);
    const caitVsJhin = result.matchups.find(
      (m) => m.championKey === '51' && m.opponentKey === '202' && m.rank === 'emerald_plus',
    );
    const jhinVsCait = result.matchups.find(
      (m) => m.championKey === '202' && m.opponentKey === '51' && m.rank === 'emerald_plus',
    );
    expect(caitVsJhin?.winRate).toBeCloseTo(0.6, 5);
    expect(jhinVsCait?.winRate).toBeCloseTo(0.4, 5);
  });

  it('records ADC + Support duo synergy', () => {
    const result = aggregate(matches);
    const duo = result.duos.find(
      (d) => d.adcKey === '51' && d.supportKey === '412' && d.rank === 'emerald_plus',
    );
    expect(duo?.games).toBe(1250);
    expect(duo?.winRate).toBeCloseTo(0.6, 5);
  });

  it('emits a most-common build with runes for the carry', () => {
    const result = aggregate(matches);
    const build = result.builds.find(
      (b) => b.championKey === '51' && b.role === 'BOTTOM' && b.opponentKey === null && b.rank === 'emerald_plus',
    );
    expect(build).toBeDefined();
    expect(build!.items).toContain(6672);
    expect(build!.runes.keystone).toBe(8005);
  });

  it('suppresses derived rows below the sample floor', () => {
    const tiny = aggregate(botLaneMatches(5, 3));
    expect(tiny.matchups).toHaveLength(0); // 5 < MIN_MATCHUP_GAMES
    expect(tiny.duos).toHaveLength(0);
    // vs-opponent builds need MIN_BUILD_GAMES of one exact signature…
    expect(tiny.builds.filter((b) => b.opponentKey !== null)).toHaveLength(0);
    // …but every champion always gets its frequency-based own build.
    expect(tiny.builds.some((b) => b.championKey === '51' && b.opponentKey === null)).toBe(true);
    // role stats are still emitted (confidence handled at display time)
    expect(tiny.roleStats.some((r) => r.championKey === '51')).toBe(true);
  });
});
