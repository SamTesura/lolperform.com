import type { ChampionMeta } from '@lolperform/shared';

/**
 * Build-time only: fetch the champion list + current version from Data Dragon so
 * Astro can prerender a page per champion (SEO) without depending on a committed
 * dataset. Live stats are fetched client-side from /api/v1 at runtime.
 */
const DDRAGON = 'https://ddragon.leagueoflegends.com';

export interface DdragonBuildData {
  version: string;
  champions: ChampionMeta[];
}

let cached: Promise<DdragonBuildData> | null = null;

/** Memoized so the shared header can call it once per build, not per page. */
export function getBuildChampions(): Promise<DdragonBuildData> {
  cached ??= loadBuildChampions();
  return cached;
}

async function loadBuildChampions(): Promise<DdragonBuildData> {
  const versions = (await (await fetch(`${DDRAGON}/api/versions.json`)).json()) as string[];
  const version = versions[0] ?? '16.12.1';
  const json = (await (
    await fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`)
  ).json()) as {
    data: Record<string, { key: string; id: string; name: string; title: string }>;
  };
  const champions = Object.values(json.data)
    .map((c) => ({ key: c.key, id: c.id, name: c.name, title: c.title, roles: [] as never[] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { version, champions };
}
