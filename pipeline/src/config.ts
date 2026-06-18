import { ACTIVE_REGIONS, type Region } from '@lolperform/shared';

/**
 * Pipeline configuration. Tunables here control how much of the ladder we sample.
 * The Riot key is read from the environment and never logged or persisted.
 */
export interface PipelineConfig {
  /** Riot API key (RGAPI-...). Required for live crawls. */
  riotApiKey: string;
  /** Platform regions to crawl. */
  regions: readonly Region[];
  /** Ranked entries to sample per league tier+division page. */
  playersPerDivision: number;
  /** Recent ranked matches to pull per sampled player. */
  matchesPerPlayer: number;
  /** Hard ceiling on unique matches per region per run (rate-limit guard). */
  maxMatchesPerRegion: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PipelineConfig {
  const riotApiKey = env.RIOT_API_KEY ?? '';
  return {
    riotApiKey,
    regions: ACTIVE_REGIONS,
    // Defaults are sized for a personal/dev key (100 requests / 2 min) to finish
    // inside the GitHub Actions timeout. Raise via env once on a production key.
    playersPerDivision: Number(env.PLAYERS_PER_DIVISION ?? 20),
    matchesPerPlayer: Number(env.MATCHES_PER_PLAYER ?? 15),
    maxMatchesPerRegion: Number(env.MAX_MATCHES_PER_REGION ?? 800),
  };
}

export function assertApiKey(config: PipelineConfig): void {
  if (!/^RGAPI-[0-9a-f-]{36}$/i.test(config.riotApiKey)) {
    throw new Error(
      'RIOT_API_KEY missing or malformed. Set it in .dev.vars locally or as a GitHub Actions secret.',
    );
  }
}
