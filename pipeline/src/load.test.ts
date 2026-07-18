import { describe, expect, it } from 'vitest';
import { buildLoadSql, type LoadInput } from './load.js';

const input: LoadInput = {
  meta: {
    patch: '16.12',
    version: '16.12.1',
    generatedAt: '2026-06-17T00:00:00.000Z',
    totalMatches: 1000,
  },
  champions: [
    { key: '145', id: 'Kaisa', name: "Kai'Sa", title: 'Daughter of the Void', roles: [] },
  ],
  roleStats: [
    {
      patch: '16.12', region: 'na1', rank: 'emerald_plus', role: 'BOTTOM', championKey: '145',
      games: 800, wins: 420, winRate: 0.525, pickRate: 0.2, banRate: 0.05,
      wilsonLower: 0.49, score: 0.49, tier: 'S', provisional: false, deltaWinRate: null, deltaTier: null,
    },
  ],
  matchups: [
    {
      patch: '16.12', region: 'na1', rank: 'emerald_plus', role: 'BOTTOM',
      championKey: '145', opponentKey: '51', games: 120, wins: 70, winRate: 0.583, wilsonLower: 0.5,
    },
  ],
  duos: [
    {
      patch: '16.12', region: 'na1', rank: 'emerald_plus',
      adcKey: '145', supportKey: '412', games: 90, wins: 50, winRate: 0.555, wilsonLower: 0.46,
    },
  ],
  builds: [
    {
      patch: '16.12', region: 'na1', rank: 'emerald_plus', role: 'BOTTOM', championKey: '145',
      opponentKey: null, items: [3006, 6672, 3094], runes: {
        keystone: 8008, primaryStyle: 8000, subStyle: 8200, primary: [8008], secondary: [8226], shards: [5005, 5008, 5001],
      }, games: 300, wins: 165, winRate: 0.55,
    },
  ],
};

describe('buildLoadSql', () => {
  const sql = buildLoadSql(input);

  it('clears the patch before inserting (idempotent)', () => {
    expect(sql).toContain("DELETE FROM role_stats WHERE patch = '16.12';");
    expect(sql).toContain("DELETE FROM patches WHERE patch = '16.12';");
  });

  it('escapes single quotes in champion names', () => {
    expect(sql).toContain("'Kai''Sa'");
    expect(sql).not.toContain("'Kai'Sa'");
  });

  it('writes each table with INSERT OR REPLACE', () => {
    for (const t of ['patches', 'champions', 'role_stats', 'matchups', 'duos', 'builds']) {
      expect(sql).toContain(`INSERT OR REPLACE INTO ${t}`);
    }
  });

  it('serializes build items/runes as JSON and maps null opponent to "-"', () => {
    expect(sql).toContain("'[3006,6672,3094]'");
    expect(sql).toContain('"keystone":8008');
    // null opponent build stored under the '-' sentinel
    expect(sql).toMatch(/INSERT OR REPLACE INTO builds[\s\S]*'-'/);
  });

  it('never emits a NaN literal', () => {
    expect(sql).not.toContain('NaN');
  });
});
