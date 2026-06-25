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

/** Thin, rate-limited Riot API client. Holds the key in memory only. */
export class RiotClient {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly apiKey: string,
    rps = 20,
  ) {
    // One per-second window; the 429/Retry-After handler is the backstop if the
    // key's app-rate limit is tighter than `rps`.
    this.limiter = new RateLimiter([{ limit: rps, intervalMs: 1000 }]);
  }

  private async request<T>(host: string, path: string): Promise<T | null> {
    const url = `https://${host}.api.riotgames.com${path}`;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.limiter.acquire();
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
