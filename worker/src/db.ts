import type {
  BuildPath,
  ChampionMeta,
  CounterPick,
  DuoSynergy,
  Matchup,
  RankBracket,
  Region,
  Role,
  RoleStats,
  RunePage,
  TierGrade,
} from '@lolperform/shared';
import type { Env } from './env.js';

/* ------------------------------------------------------------------ *
 * Row shapes (snake_case, as stored in D1)
 * ------------------------------------------------------------------ */

interface PatchRow {
  patch: string;
  version: string;
  generated_at: string;
  total_matches: number;
}
interface ChampionRow {
  champion_key: string;
  id: string;
  name: string;
  title: string;
  version: string;
}
interface RoleStatsRow {
  patch: string;
  region: string;
  rank: string;
  role: string;
  champion_key: string;
  games: number;
  wins: number;
  win_rate: number;
  pick_rate: number;
  ban_rate: number;
  wilson_lower: number;
  score: number;
  tier: string;
}
interface MatchupRow {
  patch: string;
  region: string;
  rank: string;
  role: string;
  champion_key: string;
  opponent_key: string;
  games: number;
  wins: number;
  win_rate: number;
  wilson_lower: number;
}
interface DuoRow {
  patch: string;
  region: string;
  rank: string;
  adc_key: string;
  support_key: string;
  games: number;
  wins: number;
  win_rate: number;
  wilson_lower: number;
}
interface BuildRow {
  patch: string;
  region: string;
  rank: string;
  role: string;
  champion_key: string;
  opponent_key: string;
  items: string;
  runes: string;
  games: number;
  wins: number;
  win_rate: number;
}
interface CounterRow {
  champion_key: string;
  win_rate: number;
  wilson_lower: number;
  games: number;
  tier: string;
}

/* ------------------------------------------------------------------ *
 * Pure row -> shared-type mappers (unit tested)
 * ------------------------------------------------------------------ */

export function mapChampion(r: ChampionRow): ChampionMeta {
  return { key: r.champion_key, id: r.id, name: r.name, title: r.title, roles: [] };
}

export function mapRoleStats(r: RoleStatsRow): RoleStats {
  return {
    patch: r.patch,
    region: r.region as Region,
    rank: r.rank as RankBracket,
    role: r.role as Role,
    championKey: r.champion_key,
    games: r.games,
    wins: r.wins,
    winRate: r.win_rate,
    pickRate: r.pick_rate,
    banRate: r.ban_rate,
    wilsonLower: r.wilson_lower,
    score: r.score,
    tier: r.tier as TierGrade,
    deltaWinRate: null,
    deltaTier: null,
  };
}

export function mapMatchup(r: MatchupRow): Matchup {
  return {
    patch: r.patch,
    region: r.region as Region,
    rank: r.rank as RankBracket,
    role: r.role as Role,
    championKey: r.champion_key,
    opponentKey: r.opponent_key,
    games: r.games,
    wins: r.wins,
    winRate: r.win_rate,
    wilsonLower: r.wilson_lower,
  };
}

export function mapDuo(r: DuoRow): DuoSynergy {
  return {
    patch: r.patch,
    region: r.region as Region,
    rank: r.rank as RankBracket,
    adcKey: r.adc_key,
    supportKey: r.support_key,
    games: r.games,
    wins: r.wins,
    winRate: r.win_rate,
    wilsonLower: r.wilson_lower,
  };
}

export function mapBuild(r: BuildRow): BuildPath {
  return {
    patch: r.patch,
    region: r.region as Region,
    rank: r.rank as RankBracket,
    role: r.role as Role,
    championKey: r.champion_key,
    opponentKey: r.opponent_key === '-' ? null : r.opponent_key,
    items: safeJsonArray(r.items),
    runes: safeRunes(r.runes),
    games: r.games,
    wins: r.wins,
    winRate: r.win_rate,
  };
}

export function mapCounter(r: CounterRow): CounterPick {
  return {
    championKey: r.champion_key,
    winRate: r.win_rate,
    wilsonLower: r.wilson_lower,
    games: r.games,
    tier: r.tier as TierGrade,
  };
}

function safeJsonArray(value: string): number[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as number[]) : [];
  } catch {
    return [];
  }
}

const EMPTY_RUNES: RunePage = {
  keystone: 0,
  primaryStyle: 0,
  subStyle: 0,
  primary: [],
  secondary: [],
  shards: [],
};

/** One corrupt runes row must not 500 the whole champion response. */
function safeRunes(value: string): RunePage {
  try {
    const parsed = JSON.parse(value) as RunePage;
    return parsed && typeof parsed === 'object' ? parsed : EMPTY_RUNES;
  } catch {
    return EMPTY_RUNES;
  }
}

/* ------------------------------------------------------------------ *
 * Queries — all prepared + bound (no string concatenation of inputs)
 * ------------------------------------------------------------------ */

export interface Slice {
  patch: string;
  region: Region;
  rank: RankBracket;
}

export async function getLatestPatch(env: Env): Promise<PatchRow | null> {
  return env.DB.prepare('SELECT * FROM patches ORDER BY generated_at DESC LIMIT 1').first<PatchRow>();
}

export async function getChampions(env: Env): Promise<ChampionMeta[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM champions ORDER BY name',
  ).all<ChampionRow>();
  return results.map(mapChampion);
}

export async function getChampionById(env: Env, id: string): Promise<ChampionMeta | null> {
  const row = await env.DB.prepare('SELECT * FROM champions WHERE id = ? LIMIT 1')
    .bind(id)
    .first<ChampionRow>();
  return row ? mapChampion(row) : null;
}

export async function getTierList(
  env: Env,
  slice: Slice,
  role: Role,
): Promise<RoleStats[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM role_stats
     WHERE patch = ? AND region = ? AND rank = ? AND role = ?
     ORDER BY score DESC`,
  )
    .bind(slice.patch, slice.region, slice.rank, role)
    .all<RoleStatsRow>();
  return results.map(mapRoleStats);
}

export async function getRoleStatsForChampion(
  env: Env,
  slice: Slice,
  championKey: string,
): Promise<RoleStats[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM role_stats
     WHERE patch = ? AND region = ? AND rank = ? AND champion_key = ?
     ORDER BY games DESC`,
  )
    .bind(slice.patch, slice.region, slice.rank, championKey)
    .all<RoleStatsRow>();
  return results.map(mapRoleStats);
}

export async function getMatchupsForChampion(
  env: Env,
  slice: Slice,
  championKey: string,
): Promise<Matchup[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM matchups
     WHERE patch = ? AND region = ? AND rank = ? AND champion_key = ?
     ORDER BY games DESC`,
  )
    .bind(slice.patch, slice.region, slice.rank, championKey)
    .all<MatchupRow>();
  return results.map(mapMatchup);
}

export async function getDuosForChampion(
  env: Env,
  slice: Slice,
  championKey: string,
): Promise<DuoSynergy[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM duos
     WHERE patch = ? AND region = ? AND rank = ? AND (adc_key = ? OR support_key = ?)
     ORDER BY games DESC`,
  )
    .bind(slice.patch, slice.region, slice.rank, championKey, championKey)
    .all<DuoRow>();
  return results.map(mapDuo);
}

export async function getBuildsForChampion(
  env: Env,
  slice: Slice,
  championKey: string,
): Promise<BuildPath[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM builds
     WHERE patch = ? AND region = ? AND rank = ? AND champion_key = ?
     ORDER BY games DESC`,
  )
    .bind(slice.patch, slice.region, slice.rank, championKey)
    .all<BuildRow>();
  return results.map(mapBuild);
}

export async function getDuos(env: Env, slice: Slice): Promise<DuoSynergy[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM duos
     WHERE patch = ? AND region = ? AND rank = ?
     ORDER BY games DESC LIMIT 500`,
  )
    .bind(slice.patch, slice.region, slice.rank)
    .all<DuoRow>();
  return results.map(mapDuo);
}

/** Counter picks: champions with the best record against `opponentKey` in `role`. */
export async function getCounters(
  env: Env,
  slice: Slice,
  role: Role,
  opponentKey: string,
): Promise<CounterPick[]> {
  const { results } = await env.DB.prepare(
    `SELECT m.champion_key, m.win_rate, m.wilson_lower, m.games,
            COALESCE(rs.tier, 'D') AS tier
     FROM matchups m
     LEFT JOIN role_stats rs
       ON rs.patch = m.patch AND rs.region = m.region AND rs.rank = m.rank
       AND rs.role = m.role AND rs.champion_key = m.champion_key
     WHERE m.patch = ? AND m.region = ? AND m.rank = ? AND m.role = ? AND m.opponent_key = ?
     ORDER BY m.wilson_lower DESC
     LIMIT 24`,
  )
    .bind(slice.patch, slice.region, slice.rank, role, opponentKey)
    .all<CounterRow>();
  return results.map(mapCounter);
}
