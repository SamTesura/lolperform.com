import {
  QUEUE_RANKED_SOLO,
  REGION_ROUTE,
  type LeagueDivision,
  type Platform,
} from '@lolperform/shared';
import { DEV_KEY_WINDOWS, parseRateLimitHeader, RateLimiter, sleep } from './rateLimiter.js';
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
 * Pacing has two layers:
 * - The app-wide limit governs every request. It starts at the dev-key default
 *   and re-tunes itself from Riot's own `X-App-Rate-Limit` response header, so
 *   the crawler always runs at 100% of whatever the key actually allows — dev
 *   key today, production key tomorrow, no config change.
 * - The league-v4 methods have much tighter per-method ceilings (apex 30/10s +
 *   500/10min, entries 50/10s) and get their own limiters on top.
 */
export class RiotClient {
  /** App-wide pacing — replaced by the advertised windows on first response. */
  private appLimiter: RateLimiter;
  private appLimitTuned = false;
  /** league-v4 challenger/grandmaster/master: 30 req/10s + 500 req/10min. */
  private readonly apexLimiter: RateLimiter;
  /** league-v4 entries/{queue}/{tier}/{division}: 50 req/10s. */
  private readonly entriesLimiter: RateLimiter;

  constructor(
    private readonly apiKey: string,
    rps = 20,
  ) {
    // Pre-tune default: the classic dev-key windows, with RIOT_RPS as the burst
    // override. The header replaces all of this on the first response.
    this.appLimiter = new RateLimiter([
      { limit: rps, intervalMs: 1000 },
      ...DEV_KEY_WINDOWS.filter((w) => w.intervalMs > 1000),
    ]);
    this.apexLimiter = new RateLimiter([
      { limit: 27, intervalMs: 10_000 },
      { limit: 450, intervalMs: 600_000 },
    ]);
    this.entriesLimiter = new RateLimiter([{ limit: 45, intervalMs: 10_000 }]);
  }

  private methodLimiterFor(path: string): RateLimiter | null {
    if (path.includes('leagues/by-queue')) return this.apexLimiter;
    if (path.includes('/league/v4/entries')) return this.entriesLimiter;
    return null;
  }

  /** Adopt the key's real app windows the first time Riot advertises them. */
  private tuneFromHeaders(res: Response): void {
    if (this.appLimitTuned) return;
    const header = res.headers.get('x-app-rate-limit');
    if (!header) return;
    const windows = parseRateLimitHeader(header);
    if (windows.length === 0) return;
    this.appLimiter = new RateLimiter(windows);
    this.appLimitTuned = true;
    console.info(`[riot] pacing at the key's advertised app limit: ${header}`);
  }

  private async request<T>(host: string, path: string): Promise<T | null> {
    const url = `https://${host}.api.riotgames.com${path}`;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Method ceiling first (scarcer), then the app-wide budget.
      await this.methodLimiterFor(path)?.acquire();
      await this.appLimiter.acquire();
      const res = await fetch(url, { headers: { 'X-Riot-Token': this.apiKey } });
      this.tuneFromHeaders(res);

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
    // Riot-returned ids are interpolated into request paths — keep them shaped
    // like ids so a malformed value can't redirect the request to another path.
    if (!/^[A-Za-z0-9_-]+$/.test(puuid)) return Promise.resolve(null);
    const route = REGION_ROUTE[region];
    return this.request<string[]>(
      route,
      `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${QUEUE_RANKED_SOLO}&type=ranked&count=${count}`,
    );
  }

  /** Full match detail. */
  getMatch(region: Platform, matchId: string): Promise<MatchDTO | null> {
    if (!/^[A-Za-z0-9_-]+$/.test(matchId)) return Promise.resolve(null);
    const route = REGION_ROUTE[region];
    return this.request<MatchDTO>(route, `/lol/match/v5/matches/${matchId}`);
  }
}
