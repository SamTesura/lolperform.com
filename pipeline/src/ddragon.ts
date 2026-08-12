import { championMetaSchema, type ChampionMeta } from '@lolperform/shared';

const DDRAGON = 'https://ddragon.leagueoflegends.com';

/** All published Data Dragon versions, newest first. */
export async function getVersions(): Promise<string[]> {
  const res = await fetch(`${DDRAGON}/api/versions.json`);
  if (!res.ok) throw new Error(`ddragon versions ${res.status}`);
  return (await res.json()) as string[];
}

/** Newest published Data Dragon version, e.g. "14.12.1". */
export async function getLatestVersion(): Promise<string> {
  const versions = await getVersions();
  const latest = versions[0];
  if (!latest) throw new Error('ddragon returned no versions');
  return latest;
}

/** "14.12.1" → "14.12" (patch label used throughout the dataset). */
export function patchLabel(version: string): string {
  const [major, minor] = version.split('.');
  return `${major}.${minor}`;
}

interface ChampionJson {
  data: Record<
    string,
    { key: string; id: string; name: string; title: string }
  >;
}

/**
 * Champion metadata for a version, keyed by numeric champion key.
 * `roles` is left empty here — lane roles come from match data, not Data Dragon.
 */
export async function getChampionMeta(version: string): Promise<Map<string, ChampionMeta>> {
  const res = await fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`);
  if (!res.ok) throw new Error(`ddragon champion.json ${res.status}`);
  const json = (await res.json()) as ChampionJson;

  const byKey = new Map<string, ChampionMeta>();
  for (const entry of Object.values(json.data)) {
    const meta = championMetaSchema.parse({
      key: entry.key,
      id: entry.id,
      name: entry.name,
      title: entry.title,
      roles: [],
    });
    byKey.set(meta.key, meta);
  }
  return byKey;
}

interface ItemJson {
  data: Record<
    string,
    {
      gold?: { total: number; purchasable: boolean };
      from?: string[];
      into?: string[];
      requiredAlly?: string;
      maps?: Record<string, boolean>;
    }
  >;
}

/**
 * Ids of finished items: things a build actually ends on. An item is finished
 * when nothing builds out of it and it is either assembled from components or
 * expensive enough to be an endpoint on its own. That excludes raw components
 * (they have `into`), starting items like Doran's Blade (cheap, no recipe),
 * and Ornn masterworks (not purchasable). Used so build displays show full
 * items rather than whatever happened to sit in an inventory at game end.
 */
export async function getCompletedItems(version: string): Promise<Set<number>> {
  const res = await fetch(`${DDRAGON}/cdn/${version}/data/en_US/item.json`);
  if (!res.ok) throw new Error(`ddragon item.json ${res.status}`);
  const json = (await res.json()) as ItemJson;

  const completed = new Set<number>();
  for (const [id, item] of Object.entries(json.data)) {
    if (item.requiredAlly) continue; // Ornn masterworks etc.
    if (item.gold && !item.gold.purchasable) continue;
    if (item.maps && item.maps['11'] === false) continue; // not on Summoner's Rift
    // Having `into` normally marks a component — except when every upgrade is a
    // pure upgrade of this item alone (tier-3 boots, masterworks): then this is
    // still the endpoint of a normal build. Zeal-tier components fail this,
    // because their upgrades combine them with other pieces.
    const upgrades = item.into ?? [];
    const onlyPureUpgrades = upgrades.every((t) => {
      const target = json.data[t];
      return target?.from?.length === 1 && target.from[0] === id;
    });
    if (upgrades.length > 0 && !onlyPureUpgrades) continue;
    const assembled = (item.from?.length ?? 0) > 0;
    const expensive = (item.gold?.total ?? 0) >= 1600;
    if (assembled || expensive) completed.add(Number(id));
  }
  return completed;
}

/** Finished boots (tier 2+): the Boots tag minus the basic 300g pair. */
export async function getBootItems(version: string): Promise<Set<number>> {
  const res = await fetch(`${DDRAGON}/cdn/${version}/data/en_US/item.json`);
  if (!res.ok) throw new Error(`ddragon item.json ${res.status}`);
  const json = (await res.json()) as {
    data: Record<string, { tags?: string[]; gold?: { total: number } }>;
  };
  const boots = new Set<number>();
  for (const [id, item] of Object.entries(json.data)) {
    if (item.tags?.includes('Boots') && (item.gold?.total ?? 0) > 400) boots.add(Number(id));
  }
  return boots;
}
