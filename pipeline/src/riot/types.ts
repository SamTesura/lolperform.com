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
  /** Used transiently to locate the seed player in a fetched match. NEVER
   *  stored: normalizeMatch reads it and keeps only the seed's champion,
   *  role and (rounded) baseline win rate. */
  puuid?: string;
  championId: number;
  championName: string;
  teamId: number;
  teamPosition: string;
  win: boolean;
  summoner1Id: number;
  summoner2Id: number;
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
  /** Summoner spell pair, sorted ascending so Flash+Heal and Heal+Flash are
   *  one thing. Absent on matches stored before this was captured. */
  spells?: [number, number];
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
  /**
   * The one player in this match whose ladder record we happen to know: the
   * seed the match was discovered from. Their career win rate is the only
   * available handle on player strength, and champion win rates are badly
   * confounded without it — popular champions are picked by weaker players
   * than niche ones, within the same rank. See aggregate.ts.
   *
   * Deliberately identity-free: the seed's PUUID is used in memory to find
   * them in the match and then discarded. What persists is a champion, a role
   * and a win rate rounded to 0.1% — not linkable to a person or across runs.
   */
  seed?: SeedObservation;
}

export interface SeedObservation {
  championKey: string;
  role: Role;
  /** The seed's career ranked win rate this split, rounded to 0.1%. */
  baselineWinRate: number;
}

const VALID_ROLES = new Set<Role>(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);

/** Item ids excluded from a build signature (trinkets + common consumables). */
const NON_CORE_ITEMS = new Set([
  3340,
  3363,
  3364,
  3330, // trinkets
  2003,
  2031,
  2033,
  2055,
  2138,
  2139,
  2140, // consumables / biscuits / elixirs
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
  seed?: { puuid: string; baselineWinRate: number },
): NormMatch | null {
  const patch = patchFromGameVersion(dto.info.gameVersion);
  if (!patch) return null;
  if (dto.info.participants.length !== 10) return null;

  const participants: NormParticipant[] = [];
  for (const p of dto.info.participants) {
    if (!VALID_ROLES.has(p.teamPosition as Role)) return null; // remakes / missing positions
    if (p.teamId !== 100 && p.teamId !== 200) return null;
    const pair = [p.summoner1Id, p.summoner2Id].sort((a, b) => a - b);
    participants.push({
      championKey: String(p.championId),
      role: p.teamPosition as Role,
      teamId: p.teamId,
      win: p.win,
      spells:
        Number.isFinite(pair[0]) && Number.isFinite(pair[1]) && pair[0]! > 0
          ? (pair as [number, number])
          : undefined,
      items: coreItems(p),
      runes: parseRunes(p.perks),
    });
  }

  const bans = dto.info.teams
    .flatMap((t) => t.bans.map((b) => b.championId))
    .filter((id) => id > 0);

  // Locate the seed player by PUUID, keep only what they played and how good
  // they are; the identifier itself goes no further than this function.
  let seedObs: SeedObservation | undefined;
  if (seed) {
    const i = dto.info.participants.findIndex((p) => p.puuid === seed.puuid);
    const p = i >= 0 ? participants[i] : undefined;
    if (p) {
      seedObs = {
        championKey: p.championKey,
        role: p.role,
        baselineWinRate: Math.round(seed.baselineWinRate * 1000) / 1000,
      };
    }
  }

  return { matchId: dto.metadata.matchId, patch, region, tier, bans, participants, seed: seedObs };
}
