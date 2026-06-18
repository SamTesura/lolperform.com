import {
  LEAGUE_DIVISIONS,
  QUEUE_RANKED_SOLO,
  type LeagueTier,
  type Region,
} from '@lolperform/shared';
import type { PipelineConfig } from './config.js';
import type { RiotClient } from './riot/client.js';
import { normalizeMatch, type NormMatch } from './riot/types.js';

const APEX: { tier: LeagueTier; kind: 'challenger' | 'grandmaster' | 'master' }[] = [
  { tier: 'CHALLENGER', kind: 'challenger' },
  { tier: 'GRANDMASTER', kind: 'grandmaster' },
  { tier: 'MASTER', kind: 'master' },
];

const LADDER_TIERS: LeagueTier[] = ['DIAMOND', 'EMERALD'];

function take<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n);
}

/** Collect a sample of player PUUIDs per league tier for one region. */
async function seedPuuids(
  client: RiotClient,
  region: Region,
  config: PipelineConfig,
): Promise<Map<LeagueTier, string[]>> {
  const seeds = new Map<LeagueTier, string[]>();

  for (const { tier, kind } of APEX) {
    const list = await client.getApexLeague(region, kind);
    const puuids = (list?.entries ?? [])
      .map((e) => e.puuid)
      .filter((p): p is string => typeof p === 'string');
    seeds.set(tier, take(puuids, config.playersPerDivision * 4));
  }

  for (const tier of LADDER_TIERS) {
    const puuids: string[] = [];
    for (const division of LEAGUE_DIVISIONS) {
      const entries = await client.getLeagueEntries(region, tier, division, 1);
      for (const e of entries ?? []) {
        if (typeof e.puuid === 'string') puuids.push(e.puuid);
        if (puuids.length >= config.playersPerDivision * LEAGUE_DIVISIONS.length) break;
      }
    }
    seeds.set(tier, puuids);
  }

  return seeds;
}

/**
 * Crawl a sampled set of ranked matches for the target patch across the
 * configured regions. Each match is tagged with the seed tier it was found
 * through so the aggregator can build cumulative rank brackets.
 */
export async function crawl(
  client: RiotClient,
  config: PipelineConfig,
  targetPatch: string,
): Promise<NormMatch[]> {
  const all: NormMatch[] = [];

  for (const region of config.regions) {
    const seeds = await seedPuuids(client, region, config);

    // Discover unique match ids, remembering the tier each was first seen at.
    const matchTier = new Map<string, LeagueTier>();
    outer: for (const [tier, puuids] of seeds) {
      for (const puuid of puuids) {
        const ids = await client.getMatchIds(region, puuid, config.matchesPerPlayer);
        for (const id of ids ?? []) if (!matchTier.has(id)) matchTier.set(id, tier);
        if (matchTier.size >= config.maxMatchesPerRegion) break outer;
      }
    }

    let kept = 0;
    for (const [id, tier] of matchTier) {
      const dto = await client.getMatch(region, id);
      if (!dto || dto.info.queueId !== QUEUE_RANKED_SOLO) continue;
      const norm = normalizeMatch(dto, region, tier);
      if (norm && norm.patch === targetPatch) {
        all.push(norm);
        kept += 1;
      }
    }
    console.info(
      `[crawl] ${region}: ${matchTier.size} ids discovered, ${kept} kept on patch ${targetPatch}`,
    );
  }

  return all;
}
