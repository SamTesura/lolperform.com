import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ACTIVE_REGIONS, RANK_BRACKETS } from '@lolperform/shared';
import { assertApiKey, loadConfig } from './config.js';
import { detectPatch } from './detect-patch.js';
import { getChampionMeta } from './ddragon.js';
import { RiotClient } from './riot/client.js';
import { crawl } from './crawl.js';
import { aggregate } from './aggregate.js';
import { accumulate } from './accumulate.js';
import { writeState } from './state.js';
import type { NormMatch } from './riot/types.js';

const DATA_DIR = new URL('../data/latest/', import.meta.url);
const STORE_DIR = new URL('../data/store/', import.meta.url);
const STORE_FILE = new URL('matches.ndjson', STORE_DIR);

async function writeJson(name: string, data: unknown): Promise<void> {
  await writeFile(new URL(name, DATA_DIR), `${JSON.stringify(data)}\n`, 'utf8');
}

/** Read the accumulated match store (NDJSON). Missing/corrupt → empty (fresh start). */
async function readStore(): Promise<NormMatch[]> {
  try {
    const text = await readFile(STORE_FILE, 'utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as NormMatch);
  } catch {
    return [];
  }
}

/** Persist the accumulated store back to NDJSON (the workflow syncs it to R2). */
async function writeStore(matches: NormMatch[]): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(STORE_FILE, matches.map((m) => JSON.stringify(m)).join('\n') + '\n', 'utf8');
}

async function main(): Promise<void> {
  const config = loadConfig();
  assertApiKey(config);

  const { latestVersion, latestPatch } = await detectPatch();
  console.info(`[run] target patch ${latestPatch} (ddragon ${latestVersion})`);

  const client = new RiotClient(config.riotApiKey, config.riotRps);
  const crawled = await crawl(client, config);

  // Compound volume across runs: merge this crawl into the accumulated store
  // (dedup by matchId), prune to the two most common recent patches, and tag the
  // dataset with the dominant one. Lets a rate-limited key build a credible
  // sample over time, and fills far faster once a production key lands.
  const prior = await readStore();
  const { store, dominantPatch } = accumulate(prior, crawled, latestPatch);
  await writeStore(store);
  const dropped = prior.length + crawled.length - store.length;
  console.info(
    `[run] crawl ${crawled.length} + stored ${prior.length} -> ${store.length} on patch ` +
      `${dominantPatch} (${dropped} duplicate/off-patch dropped — stats never mix patches)` +
      (dominantPatch !== latestPatch ? `; ddragon reported ${latestPatch}` : ''),
  );

  const result = aggregate(store);
  const champions = [...(await getChampionMeta(latestVersion)).values()];

  await mkdir(DATA_DIR, { recursive: true });
  await writeJson('dataset-meta.json', {
    patch: dominantPatch,
    version: latestVersion,
    generatedAt: new Date().toISOString(),
    regions: [...ACTIVE_REGIONS],
    ranks: [...RANK_BRACKETS],
    totalMatches: store.length,
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
