import type { LeagueTier, Region, Role, RunePage } from '@lolperform/shared';

/* ------------------------------------------------------------------ *
 * Riot DTO subsets (only the fields we consume)
 * ------------------------------------------------------------------ */

export interface LeagueEntryDTO {
  puuid?: string;
  summonerId?: string;
  leaguePoints: number;
  wins: number;
  losses: number;
}

export interface LeagueListDTO {
  tier: string;
  entries: LeagueEntryDTO[];
}

interface PerkStyleSelectionDTO {
  perk: number;
}

interface PerkStyleDTO {
  description: 'primaryStyle' | 'subStyle';
  style: number;
  selections: PerkStyleSelectionDTO[];
}

interface PerksDTO {
  statPerks: { offense: number; flex: number; defense: number };
  styles: PerkStyleDTO[];
}

export interface ParticipantDTO {
  championId: number;
  championName: string;
  teamId: number;
  teamPosition: string;
  win: boolean;
  item0: number;
  item1: number;
  item2: number;
  item3: number;
  item4: number;
  item5: number;
  item6: number;
  perks: PerksDTO;
}

interface TeamDTO {
  teamId: number;
  bans: { championId: number; pickTurn: number }[];
}

export interface MatchDTO {
  metadata: { matchId: string };
  info: {
    gameVersion: string;
    queueId: number;
    participants: ParticipantDTO[];
    teams: TeamDTO[];
  };
}

/* ------------------------------------------------------------------ *
 * Normalized shapes (what the aggregator consumes) — decoupled from
 * Riot's DTO so aggregation is trivially testable with small fixtures.
 * ------------------------------------------------------------------ */

export interface NormParticipant {
  championKey: string;
  role: Role;
  teamId: 100 | 200;
  win: boolean;
  /** Non-zero item ids, trinket/consumables excluded. */
  items: number[];
  runes: RunePage;
}

export interface NormMatch {
  matchId: string;
  patch: string;
  region: Region;
  tier: LeagueTier;
  /** Banned champion ids (numeric, > 0). */
  bans: number[];
  participants: NormParticipant[];
}

const VALID_ROLES = new Set<Role>(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);

/** Item ids excluded from a build signature (trinkets + common consumables). */
const NON_CORE_ITEMS = new Set([
  3340, 3363, 3364, 3330, // trinkets
  2003, 2031, 2033, 2055, 2138, 2139, 2140, // consumables / biscuits / elixirs
]);

/** "14.12.586.1234" → "14.12". Returns null for unparseable versions. */
export function patchFromGameVersion(gameVersion: string): string | null {
  const parts = gameVersion.split('.');
  if (parts.length < 2) return null;
  const patch = `${parts[0]}.${parts[1]}`;
  return /^\d{1,2}\.\d{1,2}$/.test(patch) ? patch : null;
}

function parseRunes(perks: PerksDTO): RunePage {
  const primary = perks.styles.find((s) => s.description === 'primaryStyle');
  const sub = perks.styles.find((s) => s.description === 'subStyle');
  return {
    keystone: primary?.selections[0]?.perk ?? 0,
    primaryStyle: primary?.style ?? 0,
    subStyle: sub?.style ?? 0,
    primary: primary?.selections.map((s) => s.perk) ?? [],
    secondary: sub?.selections.map((s) => s.perk) ?? [],
    shards: [perks.statPerks.offense, perks.statPerks.flex, perks.statPerks.defense],
  };
}

function coreItems(p: ParticipantDTO): number[] {
  return [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter(
    (id) => id > 0 && !NON_CORE_ITEMS.has(id),
  );
}

/**
 * Convert a raw match DTO into the normalized shape, tagging it with the region
 * and the seed tier it was sampled from. Returns null if the match isn't usable
 * (wrong patch, missing positions, not a full 10-player game).
 */
export function normalizeMatch(
  dto: MatchDTO,
  region: Region,
  tier: LeagueTier,
): NormMatch | null {
  const patch = patchFromGameVersion(dto.info.gameVersion);
  if (!patch) return null;
  if (dto.info.participants.length !== 10) return null;

  const participants: NormParticipant[] = [];
  for (const p of dto.info.participants) {
    if (!VALID_ROLES.has(p.teamPosition as Role)) return null; // remakes / missing positions
    if (p.teamId !== 100 && p.teamId !== 200) return null;
    participants.push({
      championKey: String(p.championId),
      role: p.teamPosition as Role,
      teamId: p.teamId,
      win: p.win,
      items: coreItems(p),
      runes: parseRunes(p.perks),
    });
  }

  const bans = dto.info.teams.flatMap((t) => t.bans.map((b) => b.championId)).filter((id) => id > 0);

  return { matchId: dto.metadata.matchId, patch, region, tier, bans, participants };
}
