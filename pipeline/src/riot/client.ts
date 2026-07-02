import {
  QUEUE_RANKED_SOLO,
  REGION_ROUTE,
  type LeagueDivision,
  type Platform,
} from '@lolperform/shared';
import { RateLimiter, sleep } from './rateLimiter.js';
import type { LeagueEntryDTO, LeagueListDTO, MatchDTO } from './types.js';

const MAX_RETRIES = 8;

type ApexKind = 'challenger' | 'grandmaster' | 'master';

const APEX_PATH: Record<ApexKind, string> = {
  challenger: 'challengerleagues',
  grandmaster: 'grandmasterleagues',
  master: 'masterleagues',
};

/**
 * Thin, rate-limited Riot API client. Holds the key in memory only.
 *
 * Riot limits each *method* separately on top of the app-wide limit, and the
 * gaps are huge: match-v5 allows 2000 req/10s while the apex-league methods
 * allow only 30 req/10s + 500 req/10min. One global limiter is therefore both
 * too slow for matches and too fast for league seeding, so each method family
 * gets its own limiter sized just under its documented ceiling.
 */
export class RiotClient {
  /** match-v5 (ids + detail): 2000 req/10s per method — in practice bounded by
   *  the app-wide limit, which `rps` models (raise RIOT_RPS on a bigger key). */
  private readonly matchLimiter: RateLimiter;
  /** league-v4 challenger/grandmaster/master: 30 req/10s + 500 req/10min. */
  private readonly apexLimiter: RateLimiter;
  /** league-v4 entries/{queue}/{tier}/{division}: 50 req/10s. */
  private readonly entriesLimiter: RateLimiter;

  constructor(
    private readonly apiKey: string,
    rps = 20,
  ) {
    // Sized ~10% under each documented method ceiling; the 429/Retry-After
    // handler is the backstop for the app-wide limit, which varies by key tier.
    this.matchLimiter = new RateLimiter([{ limit: rps, intervalMs: 1000 }]);
    this.apexLimiter = new RateLimiter([
      { limit: 27, intervalMs: 10_000 },
      { limit: 450, intervalMs: 600_000 },
    ]);
    this.entriesLimiter = new RateLimiter([{ limit: 45, intervalMs: 10_000 }]);
  }

  private limiterFor(path: string): RateLimiter {
    if (path.includes('leagues/by-queue')) return this.apexLimiter;
    if (path.includes('/league/v4/entries')) return this.entriesLimiter;
    return this.matchLimiter;
  }

  private async request<T>(host: string, path: string): Promise<T | null> {
    const url = `https://${host}.api.riotgames.com${path}`;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.limiterFor(path).acquire();
      const res = await fetch(url, { headers: { 'X-Riot-Token': this.apiKey } });

      if (res.ok) return (await res.json()) as T;
      if (res.status === 404) return null;

      // Auth problems are almost always a bad/expired key — fail loudly and early.
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Riot API ${res.status} for ${path}. The RIOT_API_KEY is invalid, expired, or lacks access.`,
        );
      }

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') ?? '1');
        await sleep((Number.isFinite(retryAfter) ? retryAfter : 1) * 1000);
        continue;
      }
      if (res.status >= 500) {
        await sleep(2 ** attempt * 500);
        continue;
      }
      // Other unexpected 4xx (e.g. a deprecated endpoint): skip rather than abort the crawl.
      return null;
    }
    throw new Error(`Riot API exhausted retries for ${path}`);
  }

  /** Ranked entries for a non-apex tier/division (one page of ~205). */
  getLeagueEntries(
    region: Platform,
    tier: string,
    division: LeagueDivision,
    page = 1,
  ): Promise<LeagueEntryDTO[] | null> {
    return this.request<LeagueEntryDTO[]>(
      region,
      `/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${division}?page=${page}`,
    );
  }

  /** Full apex ladder (challenger / grandmaster / master). */
  getApexLeague(region: Platform, kind: ApexKind): Promise<LeagueListDTO | null> {
    return this.request<LeagueListDTO>(
      region,
      `/lol/league/v4/${APEX_PATH[kind]}/by-queue/RANKED_SOLO_5x5`,
    );
  }

  /** Recent ranked-solo match ids for a player. */
  getMatchIds(region: Platform, puuid: string, count = 20): Promise<string[] | null> {
    const route = REGION_ROUTE[region];
    return this.request<string[]>(
      route,
      `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${QUEUE_RANKED_SOLO}&type=ranked&count=${count}`,
    );
  }

  /** Full match detail. */
  getMatch(region: Platform, matchId: string): Promise<MatchDTO | null> {
    const route = REGION_ROUTE[region];
    return this.request<MatchDTO>(route, `/lol/match/v5/matches/${matchId}`);
  }
}
