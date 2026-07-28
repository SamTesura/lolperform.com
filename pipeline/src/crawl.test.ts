import { describe, expect, it } from 'vitest';
import { QUEUE_RANKED_SOLO, type LeagueTier, type Platform } from '@lolperform/shared';
import { crawl } from './crawl.js';
import type { PipelineConfig } from './config.js';
import type { RiotClient } from './riot/client.js';
import type { LeagueListDTO, MatchDTO } from './riot/types.js';

const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;

function matchDto(matchId: string, seedPuuid?: string): MatchDTO {
  const participants = ([100, 200] as const).flatMap((teamId, t) =>
    ROLES.map((role, i) => ({
      // the seed always sits in the first slot when one is supplied
      puuid: t === 0 && i === 0 && seedPuuid ? seedPuuid : `other-${teamId}-${role}`,
      championId: t * 5 + i + 1,
      championName: `Champ${t * 5 + i + 1}`,
      teamId,
      teamPosition: role,
      win: teamId === 100,
      item0: 3031,
      item1: 0,
      item2: 0,
      item3: 0,
      item4: 0,
      item5: 0,
      item6: 3340,
      perks: {
        statPerks: { offense: 5005, flex: 5008, defense: 5011 },
        styles: [
          { description: 'primaryStyle' as const, style: 8000, selections: [{ perk: 8005 }] },
          { description: 'subStyle' as const, style: 8100, selections: [{ perk: 9111 }] },
        ],
      },
    })),
  );
  return {
    metadata: { matchId },
    info: { gameVersion: '16.14.123.456', queueId: QUEUE_RANKED_SOLO, participants, teams: [] },
  };
}

interface FakeBehavior {
  /** Regions whose apex seed calls throw (the failure mode from run 30079141984). */
  apexFails?: Set<Platform>;
  /** Regions where every seed call throws. */
  allSeedsFail?: Set<Platform>;
}

/** Minimal RiotClient double: 3 players per league, 2 match ids per player.
 *  Match ids are opaque counters (like real Riot ids) and the seed behind each
 *  is held in a side map, so the privacy assertion below is meaningful. */
function fakeClient(behavior: FakeBehavior = {}): RiotClient {
  const seedOf = new Map<string, string>();
  let nextId = 0;
  const league = (region: Platform, tag: string): LeagueListDTO => ({
    tier: tag,
    entries: Array.from({ length: 3 }, (_, i) => ({
      puuid: `${region}-${tag}-${i}`,
      leaguePoints: 0,
      wins: 60,
      losses: 40, // 60% career win rate, comfortably past MIN_BASELINE_GAMES
    })),
  });
  return {
    getApexLeague: async (region: Platform, kind: string) => {
      if (behavior.apexFails?.has(region) || behavior.allSeedsFail?.has(region)) {
        throw new Error(`exhausted retries for /lol/league/v4/${kind}`);
      }
      return league(region, kind);
    },
    getLeagueEntries: async (
      region: Platform,
      tier: LeagueTier,
      division: string,
      page: number,
    ) => {
      if (behavior.allSeedsFail?.has(region)) throw new Error('league entries unavailable');
      if (page > 1) return [];
      return league(region, `${tier}-${division}`).entries;
    },
    getMatchIds: async (region: Platform, puuid: string) =>
      [1, 2].map(() => {
        const id = `${region.toUpperCase()}_${++nextId}`;
        seedOf.set(id, puuid);
        return id;
      }),
    getMatch: async (_region: Platform, id: string) => matchDto(id, seedOf.get(id)),
  } as unknown as RiotClient;
}

function config(regions: Platform[]): PipelineConfig {
  return {
    riotApiKey: 'test-key',
    regions,
    riotRps: 4,
    maxRuntimeMinutes: 60,
    playersPerDivision: 2,
    matchesPerPlayer: 2,
    maxMatchesPerRegion: 6,
  } as PipelineConfig;
}

describe('crawl seed ordering', () => {
  it('keeps the seed list head proportional to pool sizes, not tier-equalized', async () => {
    // 90 emerald-range vs 10 apex-range seeds via a client whose ladder pools
    // dwarf the apex pools. The crawled matches' tier mix must track the pool
    // ratio — the old round-robin would have pushed apex to ~60%.
    const big = (region: Platform, tag: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        puuid: `${region}-${tag}-${i}`,
        leaguePoints: 0,
        wins: 60,
        losses: 40,
      }));
    const seedOf = new Map<string, string>();
    let seq = 0;
    const client = {
      getApexLeague: async (region: Platform, kind: string) => ({
        tier: kind,
        entries: big(region, kind, 2),
      }),
      getLeagueEntries: async (
        region: Platform,
        tier: LeagueTier,
        division: string,
        page: number,
      ) => (page > 1 ? [] : big(region, `${tier}-${division}`, 12)),
      getMatchIds: async (region: Platform, puuid: string) => {
        const id = `${region.toUpperCase()}_${++seq}`;
        seedOf.set(id, puuid);
        return [id];
      },
      getMatch: async (_region: Platform, id: string) => matchDto(id, seedOf.get(id)),
    } as unknown as RiotClient;
    // pools: EMERALD 48, DIAMOND 48, MASTER 2, GM 2, CHALLENGER 2 → apex 5.9%
    const matches = await crawl(client, {
      ...config(['na1']),
      playersPerDivision: 100,
      maxMatchesPerRegion: 60,
      matchesPerPlayer: 1,
    });
    const apex = matches.filter((m) => ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(m.tier));
    // ≤ 6 apex matches exist at all; round-robin would have surfaced all 6 in
    // the first 10 draws AND capped ladder at ~2/5 of the head.
    expect(apex.length).toBeLessThanOrEqual(6);
    expect(matches.length).toBeGreaterThanOrEqual(50);
    expect(apex.length / matches.length).toBeLessThan(0.15);
  });
});

describe('crawl seed baseline capture', () => {
  it('records the seed player champion, role and career win rate', async () => {
    const matches = await crawl(fakeClient(), config(['na1']));
    const seeded = matches.filter((m) => m.seed);
    expect(seeded.length).toBeGreaterThan(0);
    for (const m of seeded) {
      expect(m.seed!.baselineWinRate).toBeCloseTo(0.6, 5); // 60W/40L fixture
      expect(m.seed!.role).toBe('TOP'); // seed sits in the first slot
      expect(m.seed!.championKey).toBe('1');
    }
  });

  it('never persists a player identifier anywhere in the stored match', async () => {
    const matches = await crawl(fakeClient(), config(['na1']));
    const serialized = JSON.stringify(matches);
    // The fake's puuids all look like `na1-<tag>-<n>`; none may survive. (The
    // `tier` field legitimately contains rank names, so match the puuid shape,
    // not the words.)
    expect(serialized).not.toMatch(/na1-/);
    expect(serialized).not.toContain('other-');
    expect(serialized).not.toContain('puuid');
    expect(serialized).not.toContain('other-100');
    // the useful part did survive
    expect(matches.some((m) => m.seed)).toBe(true);
  });

  it('skips seeds whose ladder record is too thin to be meaningful', async () => {
    const thin = {
      getApexLeague: async (region: Platform, kind: string) => ({
        tier: kind,
        entries: [{ puuid: `${region}-${kind}-0`, leaguePoints: 0, wins: 3, losses: 2 }],
      }),
      getLeagueEntries: async (
        region: Platform,
        tier: LeagueTier,
        division: string,
        page: number,
      ) =>
        page > 1
          ? []
          : [{ puuid: `${region}-${tier}-${division}`, leaguePoints: 0, wins: 2, losses: 1 }],
      getMatchIds: async (region: Platform, puuid: string) => [`${region}_${puuid}`],
      getMatch: async (_region: Platform, id: string) => matchDto(id),
    } as unknown as RiotClient;
    // every seed is below MIN_BASELINE_GAMES, so nothing is crawled at all
    await expect(crawl(thin, config(['na1']))).rejects.toThrow(/zero matches/);
  });
});

describe('crawl resilience', () => {
  it('a dead apex endpoint skips the tier, not the region or the run', async () => {
    const matches = await crawl(
      fakeClient({ apexFails: new Set(['euw1']) }),
      config(['na1', 'euw1']),
    );
    const regions = new Set(matches.map((m) => m.region));
    expect(regions).toContain('na1');
    expect(regions).toContain('euw1'); // still crawled off its ladder seeds
  });

  it('a fully dead region is skipped; the other regions keep their matches', async () => {
    const matches = await crawl(
      fakeClient({ allSeedsFail: new Set(['euw1']) }),
      config(['na1', 'euw1']),
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(new Set(matches.map((m) => m.region))).toEqual(new Set(['na1']));
  });

  it('flushes progress after every region so an external kill loses at most one', async () => {
    const flushed: number[] = [];
    await crawl(fakeClient(), config(['na1', 'euw1']), async (soFar) => {
      flushed.push(soFar.length);
    });
    expect(flushed).toHaveLength(2); // once per region
    expect(flushed[0]!).toBeGreaterThan(0);
    expect(flushed[1]!).toBeGreaterThan(flushed[0]!); // cumulative, not per-region
  });

  it('a failing flush is logged, never fatal', async () => {
    const matches = await crawl(fakeClient(), config(['na1', 'euw1']), async () => {
      throw new Error('disk full');
    });
    expect(matches.length).toBeGreaterThan(0);
  });

  it('throws only when every region produced nothing', async () => {
    await expect(
      crawl(fakeClient({ allSeedsFail: new Set(['na1', 'euw1']) }), config(['na1', 'euw1'])),
    ).rejects.toThrow(/zero matches/);
  });
});
