import { describe, expect, it } from 'vitest';
import { RANK_BRACKETS } from '@lolperform/shared';
import { aggregate } from './aggregate.js';
import { botLaneMatches } from './__fixtures__/matches.js';

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
