import { describe, expect, it } from 'vitest';
import { QUEUE_RANKED_SOLO, type LeagueTier, type Platform } from '@lolperform/shared';
import { crawl } from './crawl.js';
import type { PipelineConfig } from './config.js';
import type { RiotClient } from './riot/client.js';
import type { LeagueListDTO, MatchDTO } from './riot/types.js';

const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;

function matchDto(matchId: string): MatchDTO {
  const participants = ([100, 200] as const).flatMap((teamId, t) =>
    ROLES.map((role, i) => ({
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

/** Minimal RiotClient double: 3 players per league, 2 match ids per player. */
function fakeClient(behavior: FakeBehavior = {}): RiotClient {
  const league = (region: Platform, tag: string): LeagueListDTO => ({
    tier: tag,
    entries: Array.from({ length: 3 }, (_, i) => ({
      puuid: `${region}-${tag}-${i}`,
      leaguePoints: 0,
      wins: 0,
      losses: 0,
    })),
  });
  return {
    getApexLeague: async (region: Platform, kind: string) => {
      if (behavior.apexFails?.has(region) || behavior.allSeedsFail?.has(region)) {
        throw new Error(`exhausted retries for /lol/league/v4/${kind}`);
      }
      return league(region, kind);
    },
    getLeagueEntries: async (region: Platform, tier: LeagueTier, division: string, page: number) => {
      if (behavior.allSeedsFail?.has(region)) throw new Error('league entries unavailable');
      if (page > 1) return [];
      return league(region, `${tier}-${division}`).entries;
    },
    getMatchIds: async (region: Platform, puuid: string) => [`${region}_${puuid}_1`, `${region}_${puuid}_2`],
    getMatch: async (_region: Platform, id: string) => matchDto(id),
  } as unknown as RiotClient;
}

function config(regions: Platform[]): PipelineConfig {
  return {
    regions,
    riotRps: 4,
    maxRuntimeMinutes: 60,
    playersPerDivision: 2,
    matchesPerPlayer: 2,
    maxMatchesPerRegion: 6,
  } as PipelineConfig;
}

describe('crawl resilience', () => {
  it('a dead apex endpoint skips the tier, not the region or the run', async () => {
    const matches = await crawl(fakeClient({ apexFails: new Set(['euw1']) }), config(['na1', 'euw1']));
    const regions = new Set(matches.map((m) => m.region));
    expect(regions).toContain('na1');
    expect(regions).toContain('euw1'); // still crawled off its ladder seeds
  });

  it('a fully dead region is skipped; the other regions keep their matches', async () => {
    const matches = await crawl(fakeClient({ allSeedsFail: new Set(['euw1']) }), config(['na1', 'euw1']));
    expect(matches.length).toBeGreaterThan(0);
    expect(new Set(matches.map((m) => m.region))).toEqual(new Set(['na1']));
  });

  it('throws only when every region produced nothing', async () => {
    await expect(
      crawl(fakeClient({ allSeedsFail: new Set(['na1', 'euw1']) }), config(['na1', 'euw1'])),
    ).rejects.toThrow(/zero matches/);
  });
});
