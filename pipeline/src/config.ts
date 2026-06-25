import { ACTIVE_REGIONS, type Platform } from '@lolperform/shared';

/**
 * Pipeline configuration. Tunables here control how much of the ladder we sample.
 * The Riot key is read from the environment and never logged or persisted.
 */
export interface PipelineConfig {
  /** Riot API key (RGAPI-...). Required for live crawls. */
  riotApiKey: string;
  /** Platform regions to crawl. */
  regions: readonly Platform[];
  /** Ranked entries to sample per league tier+division page. */
  playersPerDivision: number;
  /** Recent ranked matches to pull per sampled player. */
  matchesPerPlayer: number;
  /** Hard ceiling on unique matches per region per run (rate-limit guard). */
  maxMatchesPerRegion: number;
  /** Requests/second budget for the rate limiter (raise on a production key). */
  riotRps: number;
  /** Wall-clock budget for the whole crawl; split evenly across regions so a
   *  slow/throttled key still finishes and loads partial data before timeout. */
  maxRuntimeMinutes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PipelineConfig {
  const riotApiKey = env.RIOT_API_KEY ?? '';
  return {
    riotApiKey,
    regions: ACTIVE_REGIONS,
    // Defaults are sized for a PRODUCTION key. Broad sampling (many players, few
    // matches each) keeps the sample representative; ~25k matches/region across
    // NA/EUW/KR gives popular champions credible volume within the Actions timeout.
    // Every value is env-overridable so the cron can be tuned without a deploy.
    playersPerDivision: Number(env.PLAYERS_PER_DIVISION ?? 400),
    matchesPerPlayer: Number(env.MATCHES_PER_PLAYER ?? 8),
    maxMatchesPerRegion: Number(env.MAX_MATCHES_PER_REGION ?? 25000),
    riotRps: Number(env.RIOT_RPS ?? 20),
    maxRuntimeMinutes: Number(env.MAX_RUNTIME_MINUTES ?? 95),
  };
}

export function assertApiKey(config: PipelineConfig): void {
  if (!/^RGAPI-[0-9a-f-]{36}$/i.test(config.riotApiKey)) {
    throw new Error(
      'RIOT_API_KEY missing or malformed. Set it in .dev.vars locally or as a GitHub Actions secret.',
    );
  }
}
