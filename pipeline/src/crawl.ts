import {
  LEAGUE_DIVISIONS,
  QUEUE_RANKED_SOLO,
  type LeagueTier,
  type Region,
} from '@lolperform/shared';
import type { PipelineConfig } from './config.js';
import type { RiotClient } from './riot/client.js';
import { normalizeMatch, type NormMatch } from './riot/types.js';

/**
 * Seed-tier weights (× playersPerDivision). Weighted toward the larger
 * populations so the sample resembles the real Emerald+ ladder instead of
 * over-representing apex — the bias that made the first dataset unusable.
 */
const APEX: { tier: LeagueTier; kind: 'challenger' | 'grandmaster' | 'master'; weight: number }[] = [
  { tier: 'CHALLENGER', kind: 'challenger', weight: 0.34 },
  { tier: 'GRANDMASTER', kind: 'grandmaster', weight: 0.5 },
  { tier: 'MASTER', kind: 'master', weight: 1 },
];

const LADDER: { tier: LeagueTier; weight: number }[] = [
  { tier: 'DIAMOND', weight: 3 },
  { tier: 'EMERALD', weight: 4 },
];

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

async function apexPuuids(
  client: RiotClient,
  region: Region,
  kind: 'challenger' | 'grandmaster' | 'master',
  target: number,
): Promise<string[]> {
  const list = await client.getApexLeague(region, kind);
  const puuids = (list?.entries ?? [])
    .map((e) => e.puuid)
    .filter((p): p is string => typeof p === 'string');
  return shuffle(puuids).slice(0, target);
}

async function ladderPuuids(
  client: RiotClient,
  region: Region,
  tier: LeagueTier,
  target: number,
): Promise<string[]> {
  const out: string[] = [];
  const perDivision = Math.ceil(target / LEAGUE_DIVISIONS.length);
  for (const division of LEAGUE_DIVISIONS) {
    let got = 0;
    for (let page = 1; got < perDivision && page <= 5; page++) {
      const entries = await client.getLeagueEntries(region, tier, division, page);
      if (!entries || entries.length === 0) break;
      for (const e of entries) {
        if (typeof e.puuid === 'string') {
          out.push(e.puuid);
          got++;
        }
      }
    }
  }
  return out;
}

async function seedPuuids(
  client: RiotClient,
  region: Region,
  config: PipelineConfig,
): Promise<Map<LeagueTier, string[]>> {
  const p = config.playersPerDivision;
  const seeds = new Map<LeagueTier, string[]>();
  for (const { tier, kind, weight } of APEX) {
    seeds.set(tier, await apexPuuids(client, region, kind, Math.round(p * weight)));
  }
  for (const { tier, weight } of LADDER) {
    seeds.set(tier, await ladderPuuids(client, region, tier, Math.round(p * weight)));
  }
  return seeds;
}

/**
 * Crawl a representative, sampled set of ranked matches for the target patch.
 * Players are round-robined across tiers so the per-region cap stays balanced
 * rather than being filled entirely by one tier.
 */
export async function crawl(
  client: RiotClient,
  config: PipelineConfig,
  targetPatch: string,
): Promise<NormMatch[]> {
  const all: NormMatch[] = [];

  for (const region of config.regions) {
    const seeds = await seedPuuids(client, region, config);
    const matchTier = new Map<string, LeagueTier>();

    const queues = [...seeds.entries()].map(([tier, puuids]) => ({
      tier,
      puuids: shuffle(puuids),
      i: 0,
    }));

    let active = true;
    outer: while (active) {
      active = false;
      for (const q of queues) {
        if (q.i >= q.puuids.length) continue;
        active = true;
        const puuid = q.puuids[q.i++]!;
        const ids = await client.getMatchIds(region, puuid, config.matchesPerPlayer);
        for (const id of ids ?? []) if (!matchTier.has(id)) matchTier.set(id, q.tier);
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
