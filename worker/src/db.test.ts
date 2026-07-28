import { describe, expect, it } from 'vitest';
import { mapBuild, mapCounter, mapRoleStats } from './db.js';

describe('row mappers', () => {
  it('maps role stats and defaults deltas to null', () => {
    const r = mapRoleStats({
      patch: '16.12',
      region: 'na1',
      rank: 'emerald_plus',
      role: 'BOTTOM',
      champion_key: '51',
      games: 800,
      wins: 420,
      win_rate: 0.525,
      pick_rate: 0.2,
      ban_rate: 0.05,
      adjusted_win_rate: null,
      player_pool_delta: null,
      wilson_lower: 0.49,
      score: 0.49,
      tier: 'S',
    });
    expect(r.championKey).toBe('51');
    expect(r.tier).toBe('S');
    expect(r.deltaWinRate).toBeNull();
  });

  it('maps a build: parses JSON items/runes and decodes the no-opponent sentinel', () => {
    const b = mapBuild({
      patch: '16.12',
      region: 'na1',
      rank: 'emerald_plus',
      role: 'BOTTOM',
      champion_key: '51',
      opponent_key: '-',
      items: '[3006,6672,3094]',
      runes:
        '{"keystone":8008,"primaryStyle":8000,"subStyle":8200,"primary":[8008],"secondary":[8226],"shards":[5005,5008,5001]}',
      games: 300,
      wins: 165,
      win_rate: 0.55,
    });
    expect(b.opponentKey).toBeNull();
    expect(b.items).toEqual([3006, 6672, 3094]);
    expect(b.runes.keystone).toBe(8008);
  });

  it('tolerates malformed build items without throwing', () => {
    const b = mapBuild({
      patch: '16.12',
      region: 'na1',
      rank: 'emerald_plus',
      role: 'BOTTOM',
      champion_key: '51',
      opponent_key: '202',
      items: 'not-json',
      runes: '{"keystone":0,"primaryStyle":0,"subStyle":0,"primary":[],"secondary":[],"shards":[]}',
      games: 30,
      wins: 18,
      win_rate: 0.6,
    });
    expect(b.items).toEqual([]);
    expect(b.opponentKey).toBe('202');
  });

  it('maps a counter pick', () => {
    const c = mapCounter({
      champion_key: '202',
      win_rate: 0.56,
      wilson_lower: 0.51,
      games: 140,
      tier: 'A',
    });
    expect(c).toEqual({
      championKey: '202',
      winRate: 0.56,
      wilsonLower: 0.51,
      games: 140,
      tier: 'A',
    });
  });
});
