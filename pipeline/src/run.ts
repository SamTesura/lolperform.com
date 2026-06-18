import { mkdir, writeFile } from 'node:fs/promises';
import { ACTIVE_REGIONS, RANK_BRACKETS } from '@lolperform/shared';
import { assertApiKey, loadConfig } from './config.js';
import { detectPatch } from './detect-patch.js';
import { getChampionMeta } from './ddragon.js';
import { RiotClient } from './riot/client.js';
import { crawl } from './crawl.js';
import { aggregate } from './aggregate.js';
import { writeState } from './state.js';

const DATA_DIR = new URL('../data/latest/', import.meta.url);

async function writeJson(name: string, data: unknown): Promise<void> {
  await writeFile(new URL(name, DATA_DIR), `${JSON.stringify(data)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const config = loadConfig();
  assertApiKey(config);

  const { latestVersion, latestPatch } = await detectPatch();
  console.info(`[run] target patch ${latestPatch} (ddragon ${latestVersion})`);

  const client = new RiotClient(config.riotApiKey);
  const matches = await crawl(client, config, latestPatch);
  console.info(`[run] aggregating ${matches.length} matches`);

  const result = aggregate(matches);
  const champions = [...(await getChampionMeta(latestVersion)).values()];

  await mkdir(DATA_DIR, { recursive: true });
  await writeJson('dataset-meta.json', {
    patch: latestPatch,
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
