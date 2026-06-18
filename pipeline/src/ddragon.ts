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
