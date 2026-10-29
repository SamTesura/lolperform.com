import {
  LEAGUE_DIVISIONS,
  QUEUE_RANKED_SOLO,
  type LeagueTier,
  type Platform,
} from '@lolperform/shared';
import type { PipelineConfig } from './config.js';
import type { RiotClient } from './riot/client.js';
import type { LeagueEntryDTO } from './riot/types.js';
import { normalizeMatch, type NormMatch } from './riot/types.js';

/**
 * Seed-tier weights (× playersPerDivision). Apex is oversampled against its real
 * ladder share (~5% of Emerald+) so master_plus keeps a usable sample;
 * aggregation post-stratifies every bracket back to TIER_POPULATION_SHARE.
 */
const APEX: { tier: LeagueTier; kind: 'challenger' | 'grandmaster' | 'master'; weight: number }[] =
  [
    { tier: 'CHALLENGER', kind: 'challenger', weight: 0.34 },
    { tier: 'GRANDMASTER', kind: 'grandmaster', weight: 0.5 },
    { tier: 'MASTER', kind: 'master', weight: 1 },
  ];

const LADDER: { tier: LeagueTier; weight: number }[] = [
  { tier: 'DIAMOND', weight: 3 },
  { tier: 'EMERALD', weight: 4 },
];

/**
 * A seed player: the PUUID the crawl starts from, plus their career ranked win
 * rate this split (league-v4 returns wins and losses with every entry). That
 * win rate is the pipeline's only player-strength signal. The PUUID finds match
 * ids and the player inside a fetched match, then is dropped (see normalizeMatch).
 */
export interface SeedPlayer {
  puuid: string;
  baselineWinRate: number;
}

/** Ignore seeds with too thin a record for their win rate to mean anything. */
const MIN_BASELINE_GAMES = 20;

function toSeedPlayers(entries: readonly LeagueEntryDTO[]): SeedPlayer[] {
  const out: SeedPlayer[] = [];
  for (const e of entries) {
    if (typeof e.puuid !== 'string') continue;
    const games = e.wins + e.losses;
    if (!Number.isFinite(games) || games < MIN_BASELINE_GAMES) continue;
    out.push({ puuid: e.puuid, baselineWinRate: e.wins / games });
  }
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/**
 * Run `fn` over `items` with bounded concurrency. The Riot client's rate limiter
 * caps the request rate; concurrency keeps enough requests in flight that
 * throughput is limiter-bound, not latency-bound.
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
  region: Platform,
  kind: 'challenger' | 'grandmaster' | 'master',
  target: number,
): Promise<SeedPlayer[]> {
  const list = await client.getApexLeague(region, kind);
  return shuffle(toSeedPlayers(list?.entries ?? [])).slice(0, target);
}

async function ladderPuuids(
  client: RiotClient,
  region: Platform,
  tier: LeagueTier,
  target: number,
): Promise<SeedPlayer[]> {
  const out: SeedPlayer[] = [];
  const perDivision = Math.ceil(target / LEAGUE_DIVISIONS.length);
  for (const division of LEAGUE_DIVISIONS) {
    let got = 0;
    for (let page = 1; got < perDivision && page <= 5; page++) {
      const entries = await client.getLeagueEntries(region, tier, division, page);
      if (!entries || entries.length === 0) break;
      for (const seed of toSeedPlayers(entries)) {
        out.push(seed);
        got++;
      }
    }
  }
  return out;
}

async function seedPuuids(
  client: RiotClient,
  region: Platform,
  config: PipelineConfig,
): Promise<Map<LeagueTier, SeedPlayer[]>> {
  const p = config.playersPerDivision;
  const seeds = new Map<LeagueTier, SeedPlayer[]>();
  // A dead league-v4 endpoint costs only its tier: it seeds empty and the
  // remaining tiers still give a usable, slightly less balanced sample.
  for (const { tier, kind, weight } of APEX) {
    try {
      seeds.set(tier, await apexPuuids(client, region, kind, Math.round(p * weight)));
    } catch (err) {
      console.warn(`[crawl] ${region}: ${kind} seeding failed, tier skipped — ${String(err)}`);
      seeds.set(tier, []);
    }
  }
  for (const { tier, weight } of LADDER) {
    try {
      seeds.set(tier, await ladderPuuids(client, region, tier, Math.round(p * weight)));
    } catch (err) {
      console.warn(`[crawl] ${region}: ${tier} seeding failed, tier skipped — ${String(err)}`);
      seeds.set(tier, []);
    }
  }
  return seeds;
}

/**
 * Flatten the per-tier seed lists into one uniformly shuffled list. Every prefix
 * stays proportional to the pool sizes (in expectation), so the
 * `slice(0, needPuuids)` cap keeps the intended tier mix. A per-tier round-robin
 * would equalize tiers and make the three apex tiers ~60% of every crawl.
 */
function sampleOrder(
  seeds: Map<LeagueTier, SeedPlayer[]>,
): { seed: SeedPlayer; tier: LeagueTier }[] {
  const out = [...seeds.entries()].flatMap(([tier, players]) =>
    players.map((seed) => ({ seed, tier })),
  );
  return shuffle(out);
}

/**
 * Crawl a sampled set of recent ranked matches across regions. Discovery and
 * fetch both run with bounded concurrency so a region finishes inside the
 * Actions timeout.
 *
 * Every valid match is kept whatever its patch: Data Dragon's CDN version lags
 * or leads the live game patch, so filtering on it drops most matches.
 * accumulate() picks the dataset patch from the data.
 *
 * A dead seed endpoint skips its tier and a failed region skips that region;
 * only a run with zero matches overall throws. `onRegionDone` (best-effort,
 * awaited between regions) lets the caller flush progress, so an eviction or
 * timeout costs at most the region in flight.
 */
/** Fetch the timeline for every Nth discovered match (see crawlRegion). */
const TIMELINE_SAMPLE_EVERY = 5;

export async function crawl(
  client: RiotClient,
  config: PipelineConfig,
  onRegionDone?: (matchesSoFar: readonly NormMatch[]) => Promise<void>,
): Promise<NormMatch[]> {
  const all: NormMatch[] = [];
  // Split the wall-clock budget evenly across regions. Each region gives most
  // of its share to match fetch, the bulk of the work (see crawlRegion).
  const regionBudgetMs = (config.maxRuntimeMinutes * 60_000) / Math.max(1, config.regions.length);

  for (const region of config.regions) {
    try {
      await crawlRegion(client, region, config, regionBudgetMs, all);
    } catch (err) {
      // One region never aborts the run: matches already crawled from the
      // other regions are hours of rate-limited work.
      console.error(`[crawl] ${region}: region failed, continuing — ${String(err)}`);
    }
    try {
      await onRegionDone?.(all);
    } catch (err) {
      console.warn(`[crawl] progress flush after ${region} failed — ${String(err)}`);
    }
  }

  if (all.length === 0) {
    // Nothing salvageable: fail loudly so the workflow run shows red. Progress
    // flushes wrote back only the prior store, so no data is lost.
    throw new Error('crawl kept zero matches across all regions — Riot API likely unavailable');
  }

  return all;
}

/** Crawl one region into `all`. Throws only on unexpected failures; the
 *  per-request and per-tier paths inside degrade on their own. */
async function crawlRegion(
  client: RiotClient,
  region: Platform,
  config: PipelineConfig,
  regionBudgetMs: number,
  all: NormMatch[],
): Promise<void> {
  const concurrency = config.riotRps;
  const regionStart = Date.now();
  const idDeadline = regionStart + regionBudgetMs * 0.35;
  const matchDeadline = regionStart + regionBudgetMs * 0.97;
  const seeds = await seedPuuids(client, region, config);

  // Sample only enough players to reach the match cap, plus 50% for duplicates
  // and unusable or non-solo-queue matches.
  const needPuuids = Math.ceil((config.maxMatchesPerRegion / config.matchesPerPlayer) * 1.5);
  const seedList = sampleOrder(seeds).slice(0, needPuuids);

  const idLists = await mapPool(seedList, concurrency, async (s) => {
    if (Date.now() > idDeadline) return { ...s, ids: [] as string[] };
    try {
      const ids = (await client.getMatchIds(region, s.seed.puuid, config.matchesPerPlayer)) ?? [];
      return { ...s, ids };
    } catch {
      // A single rate-limited or failed request does not abort the crawl.
      return { ...s, ids: [] as string[] };
    }
  });

  // Each match remembers the seed it was discovered from, so normalizeMatch can
  // record that player's champion and career win rate.
  const discovered = new Map<string, { tier: LeagueTier; seed?: SeedPlayer }>();
  for (const { tier, seed, ids } of idLists) {
    // Only the first match kept from a seed carries their baseline. Tagging all
    // of a player's matchesPerPlayer games would repeat one player's number, so
    // the per-champion mean would rest on far fewer independent players than
    // its count suggests. One observation per player per crawl.
    let carried = false;
    for (const id of ids) {
      if (discovered.size >= config.maxMatchesPerRegion) break;
      if (discovered.has(id)) continue;
      discovered.set(id, { tier, seed: carried ? undefined : seed });
      carried = true;
    }
  }

  const entries = [...discovered.entries()];
  // Starting items need the timeline, a second request per match. One match in
  // five keeps the overhead at 20%, and the handful of viable opening buys per
  // champion still fills fast.
  const timelineIds = new Set(
    entries.filter((_, i) => i % TIMELINE_SAMPLE_EVERY === 0).map(([id]) => id),
  );
  const norms = await mapPool(entries, concurrency, async ([id, { tier, seed }]) => {
    if (Date.now() > matchDeadline) return null;
    try {
      const dto = await client.getMatch(region, id);
      if (!dto || dto.info.queueId !== QUEUE_RANKED_SOLO) return null;
      let timeline = null;
      if (timelineIds.has(id)) {
        try {
          timeline = await client.getMatchTimeline(region, id);
        } catch {
          // Start data is optional; the match is still worth keeping.
        }
      }
      return normalizeMatch(dto, region, tier, seed, timeline);
    } catch {
      return null;
    }
  });

  let kept = 0;
  let withSeed = 0;
  const byPatch = new Map<string, number>();
  for (const norm of norms) {
    if (!norm) continue;
    all.push(norm);
    kept += 1;
    if (norm.seed) withSeed += 1;
    byPatch.set(norm.patch, (byPatch.get(norm.patch) ?? 0) + 1);
  }
  const top = [...byPatch.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([p, n]) => `${p}:${n}`)
    .join(' ');
  console.info(
    `[crawl] ${region}: ${discovered.size} ids discovered, ${kept} matches kept ` +
      `(${withSeed} with a seed baseline) (patches ${top})`,
  );
}
