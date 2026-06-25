import { mkdir, writeFile } from 'node:fs/promises';
import { ACTIVE_REGIONS, RANK_BRACKETS } from '@lolperform/shared';
import { assertApiKey, loadConfig } from './config.js';
import { detectPatch } from './detect-patch.js';
import { getChampionMeta } from './ddragon.js';
import { RiotClient } from './riot/client.js';
import { crawl } from './crawl.js';
import { aggregate } from './aggregate.js';
import { writeState } from './state.js';
import type { NormMatch } from './riot/types.js';

const DATA_DIR = new URL('../data/latest/', import.meta.url);

async function writeJson(name: string, data: unknown): Promise<void> {
  await writeFile(new URL(name, DATA_DIR), `${JSON.stringify(data)}\n`, 'utf8');
}

/** The patch the most crawled matches are actually on (Data Dragon's CDN
 *  version is an unreliable proxy for the live game patch). */
function pickDominantPatch(matches: NormMatch[]): string | null {
  const counts = new Map<string, number>();
  for (const m of matches) counts.set(m.patch, (counts.get(m.patch) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [patch, n] of counts) {
    if (n > bestN) {
      best = patch;
      bestN = n;
    }
  }
  return best;
}

async function main(): Promise<void> {
  const config = loadConfig();
  assertApiKey(config);

  const { latestVersion, latestPatch } = await detectPatch();
  console.info(`[run] target patch ${latestPatch} (ddragon ${latestVersion})`);

  const client = new RiotClient(config.riotApiKey, config.riotRps);
  const crawled = await crawl(client, config);

  // Trust the data over Data Dragon: tag the dataset with the patch the most
  // matches are actually on, not the (often out-of-sync) CDN version.
  const dominantPatch = pickDominantPatch(crawled) ?? latestPatch;
  const matches = crawled.filter((m) => m.patch === dominantPatch);
  console.info(
    `[run] aggregating ${matches.length}/${crawled.length} matches on patch ${dominantPatch}` +
      (dominantPatch !== latestPatch ? ` (ddragon reported ${latestPatch})` : ''),
  );

  const result = aggregate(matches);
  const champions = [...(await getChampionMeta(latestVersion)).values()];

  await mkdir(DATA_DIR, { recursive: true });
  await writeJson('dataset-meta.json', {
    patch: dominantPatch,
    version: latestVersion,
    generatedAt: new Date().toISOString(),
    regions: [...ACTIVE_REGIONS],
    ranks: [...RANK_BRACKETS],
    totalMatches: matches.length,
    counts: {
      roleStats: result.roleStats.length,
      matchups: result.matchups.length,
      duos: result.duos.length,
      builds: result.builds.length,
    },
  });
  await writeJson('champions.json', champions);
  await writeJson('role-stats.json', result.roleStats);
  await writeJson('matchups.json', result.matchups);
  await writeJson('duos.json', result.duos);
  await writeJson('builds.json', result.builds);

  await writeState({
    lastPatch: latestPatch,
    lastVersion: latestVersion,
    lastRunAt: new Date().toISOString(),
  });

  console.info('[run] wrote dataset to pipeline/data/latest');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
