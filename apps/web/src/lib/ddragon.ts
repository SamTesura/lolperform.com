/**
 * Data Dragon asset URL helpers. Images come from Riot's free static CDN — no
 * API key required. The full ddragon version (e.g. "14.12.1") differs from our
 * patch label ("14.12"); callers pass the version surfaced by the dataset meta.
 */

const CDN = 'https://ddragon.leagueoflegends.com/cdn';

/** Fallback used until a dataset meta supplies the live version. Updated each patch. */
export const FALLBACK_DDRAGON_VERSION = '16.12.1';

/** Square champion portrait. `championId` is the alphanumeric id, e.g. "MissFortune". */
export function championSquare(championId: string, version = FALLBACK_DDRAGON_VERSION): string {
  return `${CDN}/${version}/img/champion/${championId}.png`;
}

/** Champion loading splash (wide). Uses the raw asset path (version-independent). */
export function championSplash(championId: string, skin = 0): string {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championId}_${skin}.jpg`;
}

/** Item icon by numeric item id. */
export function itemIcon(itemId: number, version = FALLBACK_DDRAGON_VERSION): string {
  return `${CDN}/${version}/img/item/${itemId}.png`;
}
