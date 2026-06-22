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

/**
 * Run `fn` over `items` with bounded concurrency. The Riot client's rate limiter
 * still caps the actual request rate; concurrency just keeps that many requests
 * in flight so throughput is limiter-bound, not latency-bound (the bug that made
 * the sequential crawl time out).
 */
async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
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

/** Round-robin the per-tier puuid lists into one balanced, interleaved list. */
function interleave(seeds: Map<LeagueTier, string[]>): { puuid: string; tier: LeagueTier }[] {
  const queues = [...seeds.entries()].map(([tier, puuids]) => ({ tier, puuids: shuffle([...puuids]) }));
  const out: { puuid: string; tier: LeagueTier }[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const q of queues) {
      const puuid = q.puuids.pop();
      if (puuid) {
        out.push({ puuid, tier: q.tier });
        added = true;
      }
    }
  }
  return out;
}

/**
 * Crawl a representative, sampled set of ranked matches for the target patch.
 * Both discovery (match ids per player) and fetch (match detail) run with
 * bounded concurrency so a region finishes well inside the Actions timeout.
 */
export async function crawl(
  client: RiotClient,
  config: PipelineConfig,
  targetPatch: string,
): Promise<NormMatch[]> {
  const all: NormMatch[] = [];
  const concurrency = config.riotRps;
  // Split the wall-clock budget evenly across regions; reserve most of each
  // region's slice for match-fetch (the bulk) over id-discovery.
  const regionBudgetMs = (config.maxRuntimeMinutes * 60_000) / Math.max(1, config.regions.length);

  for (const region of config.regions) {
    const regionStart = Date.now();
    const idDeadline = regionStart + regionBudgetMs * 0.35;
    const matchDeadline = regionStart + regionBudgetMs * 0.97;
    const seeds = await seedPuuids(client, region, config);

    // Only sample as many players as we need to reach the match cap (+buffer for
    // de-duplication and off-patch / non-soloq matches).
    const needPuuids = Math.ceil((config.maxMatchesPerRegion / config.matchesPerPlayer) * 1.5);
    const seedList = interleave(seeds).slice(0, needPuuids);

    const idLists = await mapPool(seedList, concurrency, async (s) => {
      if (Date.now() > idDeadline) return { tier: s.tier, ids: [] as string[] };
      try {
        const ids = (await client.getMatchIds(region, s.puuid, config.matchesPerPlayer)) ?? [];
        return { tier: s.tier, ids };
      } catch {
        // A single rate-limited/failed request must not abort the whole crawl.
        return { tier: s.tier, ids: [] as string[] };
      }
    });

    const matchTier = new Map<string, LeagueTier>();
    for (const { tier, ids } of idLists) {
      for (const id of ids) {
        if (matchTier.size >= config.maxMatchesPerRegion) break;
        if (!matchTier.has(id)) matchTier.set(id, tier);
      }
    }

    const entries = [...matchTier.entries()];
    const norms = await mapPool(entries, concurrency, async ([id, tier]) => {
      if (Date.now() > matchDeadline) return null;
      try {
        const dto = await client.getMatch(region, id);
        if (!dto || dto.info.queueId !== QUEUE_RANKED_SOLO) return null;
        return normalizeMatch(dto, region, tier);
      } catch {
        return null;
      }
    });

    let kept = 0;
    for (const norm of norms) {
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
