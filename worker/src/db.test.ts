import { describe, expect, it } from 'vitest';
import {
  hydrateBuild,
  hydrateRoleStats,
  mapCounter,
  parseChampionPayload,
  parseDuoSlice,
  parseRoleSlice,
  type Slice,
  type StoredBuild,
} from './db.js';

const slice: Slice = { patch: '16.12', region: 'na1', rank: 'emerald_plus' };

const build: StoredBuild = {
  opponentKey: null,
  items: [3006, 6672, 3094],
  runes: {
    keystone: 8008,
    primaryStyle: 8000,
    subStyle: 8200,
    primary: [8008],
    secondary: [8226],
    shards: [5005, 5008, 5001],
  },
  games: 300,
  wins: 165,
  winRate: 0.55,
  slotOptions: null,
  bootOptions: null,
  spellOptions: null,
  coreOptions: null,
  startOptions: null,
};

describe('payload parsers', () => {
  it('parses a champion payload into its five lists', () => {
    const p = parseChampionPayload(
      JSON.stringify({
        matchups: [{ opponentKey: '51', games: 120, wins: 70, winRate: 0.583, wilsonLower: 0.5 }],
        builds: [build],
        keystones: [{ keystone: 8008, games: 420, wins: 231, winRate: 0.55, wilsonLower: 0.5 }],
        runePages: [],
        duos: [],
      }),
    );
    expect(p.matchups[0]!.opponentKey).toBe('51');
    expect(p.builds).toHaveLength(1);
    expect(p.keystones[0]!.games).toBe(420);
  });

  it('degrades a corrupt or half-written payload to empty lists, never a 500', () => {
    for (const bad of ['not-json', '', null, undefined, '{"matchups":"nope"}']) {
      const p = parseChampionPayload(bad);
      expect(p.matchups).toEqual([]);
      expect(p.builds).toEqual([]);
      expect(p.duos).toEqual([]);
    }
  });

  it('parses role and duo slices, tolerating a missing key', () => {
    expect(parseRoleSlice('{"stats":[{"championKey":"145"}]}')).toHaveLength(1);
    expect(parseRoleSlice('{}')).toEqual([]);
    expect(parseDuoSlice('{"duos":[{"adcKey":"145","supportKey":"412"}]}')).toHaveLength(1);
    expect(parseDuoSlice('garbage')).toEqual([]);
  });
});

describe('hydrators', () => {
  it('re-attaches the slice key the payload no longer stores', () => {
    const r = hydrateRoleStats(
      {
        championKey: '51',
        games: 800,
        wins: 420,
        winRate: 0.525,
        pickRate: 0.2,
        banRate: 0.05,
        wilsonLower: 0.49,
        adjustedWinRate: null,
        playerPoolDelta: null,
        score: 0.49,
        tier: 'S',
      },
      slice,
      'BOTTOM',
    );
    expect(r.patch).toBe('16.12');
    expect(r.region).toBe('na1');
    expect(r.role).toBe('BOTTOM');
    expect(r.championKey).toBe('51');
    expect(r.tier).toBe('S');
    expect(r.deltaWinRate).toBeNull();
  });

  it('hydrates a build and keeps a null opponent null', () => {
    const b = hydrateBuild(build, slice, 'BOTTOM', '51');
    expect(b.opponentKey).toBeNull();
    expect(b.items).toEqual([3006, 6672, 3094]);
    expect(b.runes.keystone).toBe(8008);
    expect(b.slotOptions).toBeNull();
  });

  it('decodes the pre-0011 "-" opponent sentinel a backfilled row can carry', () => {
    expect(
      hydrateBuild({ ...build, opponentKey: '-' }, slice, 'BOTTOM', '51').opponentKey,
    ).toBeNull();
    expect(hydrateBuild({ ...build, opponentKey: '202' }, slice, 'BOTTOM', '51').opponentKey).toBe(
      '202',
    );
  });

  it('tolerates malformed build items and runes without throwing', () => {
    const b = hydrateBuild(
      { ...build, items: 'not-an-array' as unknown as number[], runes: null as never },
      slice,
      'BOTTOM',
      '51',
    );
    expect(b.items).toEqual([]);
    expect(b.runes.keystone).toBe(0);
  });
});

describe('mapCounter', () => {
  it('maps a counter pick with its tier', () => {
    expect(
      mapCounter({ champion_key: '202', games: 140, win_rate: 0.56, wilson_lower: 0.51 }, 'A'),
    ).toEqual({ championKey: '202', winRate: 0.56, wilsonLower: 0.51, games: 140, tier: 'A' });
  });

  it('falls back to D when the champion has no stored role stats', () => {
    expect(
      mapCounter({ champion_key: '202', games: 140, win_rate: 0.56, wilson_lower: 0.51 }, undefined)
        .tier,
    ).toBe('D');
  });
});
