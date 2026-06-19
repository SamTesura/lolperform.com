import { describe, expect, it } from 'vitest';
import { RANK_BRACKETS } from '@lolperform/shared';
import { aggregate } from './aggregate.js';
import { botLaneMatches } from './__fixtures__/matches.js';

describe('aggregate', () => {
  const matches = botLaneMatches(250, 150); // Caitlyn bot wins 150/250 = 60% (>= min-tier games)

  it('computes per-role win/pick rates and tiers', () => {
    const result = aggregate(matches);
    const cait = result.roleStats.filter(
      (r) => r.championKey === '51' && r.role === 'BOTTOM' && r.rank === 'emerald_plus',
    );
    expect(cait).toHaveLength(1);
    const c = cait[0]!;
    expect(c.games).toBe(250);
    expect(c.wins).toBe(150);
    expect(c.winRate).toBeCloseTo(0.6, 5);
    expect(c.pickRate).toBeCloseTo(1, 5); // present in every game on team 100
    expect(c.tier).toBe('S'); // 60% over 100 games
    expect(c.wilsonLower).toBeLessThan(c.winRate);
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
    expect(duo?.games).toBe(250);
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
    expect(tiny.builds).toHaveLength(0); // 5 < MIN_BUILD_GAMES
    // role stats are still emitted (confidence handled at display time)
    expect(tiny.roleStats.some((r) => r.championKey === '51')).toBe(true);
  });
});
