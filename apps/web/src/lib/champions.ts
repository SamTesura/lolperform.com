import type { ChampionMeta } from '@lolperform/shared';

/** Build a champion-key → metadata lookup from the /meta response. */
export function championIndex(champions: ChampionMeta[]): Map<string, ChampionMeta> {
  return new Map(champions.map((c) => [c.key, c]));
}
