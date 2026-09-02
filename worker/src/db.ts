import {
  gradeSlice,
  skillFloorFor,
  type BuildPath,
  type ChampionMeta,
  type CounterPick,
  type DuoSynergy,
  type GradeInput,
  type KeystoneStats,
  type RunePageStats,
  type Matchup,
  type RankBracket,
  type Region,
  type Role,
  type RoleStats,
  type RunePage,
  type FullTierGrade,
} from '@lolperform/shared';
import type { Env } from './env.js';

/* ------------------------------------------------------------------ *
 * Row shapes (snake_case, as stored in D1)
 *
 * The per-champion tables (matchups, builds, keystone_stats, rune_pages) and
 * role_stats were folded into JSON payloads in migration 0011 — D1 bills per
 * row written, and the fan-out cost ~1M row writes per refresh against a free
 * ceiling of 100k/day. What is left is three slice tables whose payloads are
 * parsed here. See db/migrations/0011_slice_tables.sql.
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
interface SliceRow {
  payload: string;
}
interface ChampionSliceRow extends SliceRow {
  role: string;
}
interface CounterRow {
  champion_key: string;
  games: number;
  win_rate: number;
  wilson_lower: number;
}

/* ------------------------------------------------------------------ *
 * Payload shapes — mirrors of the writer in pipeline/src/load.ts.
 * ------------------------------------------------------------------ */

export interface StoredMatchup {
  opponentKey: string;
  games: number;
  wins: number;
  winRate: number;
  wilsonLower: number;
}
export interface StoredBuild {
  opponentKey: string | null;
  items: number[];
  runes: RunePage;
  games: number;
  wins: number;
  winRate: number;
  slotOptions: BuildPath['slotOptions'];
  bootOptions: BuildPath['bootOptions'];
  spellOptions: BuildPath['spellOptions'];
  coreOptions: BuildPath['coreOptions'];
  startOptions: BuildPath['startOptions'];
}
export interface StoredKeystone {
  keystone: number;
  games: number;
  wins: number;
  winRate: number;
  wilsonLower: number;
}
export interface StoredRunePage {
  slot: number;
  runes: RunePage;
  games: number;
  wins: number;
  winRate: number;
  wilsonLower: number;
}
export interface StoredDuo {
  adcKey: string;
  supportKey: string;
  games: number;
  wins: number;
  winRate: number;
  wilsonLower: number;
}
export interface ChampionPayload {
  matchups: StoredMatchup[];
  builds: StoredBuild[];
  keystones: StoredKeystone[];
  runePages: StoredRunePage[];
  duos: StoredDuo[];
}
export interface StoredRoleStat {
  championKey: string;
  games: number;
  wins: number;
  winRate: number;
  pickRate: number;
  banRate: number;
  wilsonLower: number;
  adjustedWinRate: number | null;
  playerPoolDelta: number | null;
  score: number;
  tier: string;
}

/* ------------------------------------------------------------------ *
 * Payload parsers — tolerant by design (unit tested)
 *
 * A payload is written by our own pipeline, but a truncated or half-migrated
 * row must degrade to "no data" rather than 500 the whole champion page.
 * ------------------------------------------------------------------ */

const EMPTY_RUNES: RunePage = {
  keystone: 0,
  primaryStyle: 0,
  subStyle: 0,
  primary: [],
  secondary: [],
  shards: [],
};

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRunes(value: unknown): RunePage {
  return value && typeof value === 'object' ? (value as RunePage) : EMPTY_RUNES;
}

/** One champion_slice payload, with every list guaranteed present. */
export function parseChampionPayload(payload: string | null | undefined): ChampionPayload {
  const raw = parseJson<Partial<ChampionPayload>>(payload) ?? {};
  return {
    matchups: asArray<StoredMatchup>(raw.matchups),
    builds: asArray<StoredBuild>(raw.builds),
    keystones: asArray<StoredKeystone>(raw.keystones),
    runePages: asArray<StoredRunePage>(raw.runePages),
    duos: asArray<StoredDuo>(raw.duos),
  };
}

/** One role_slice payload: the slice's ungraded role stats. */
export function parseRoleSlice(payload: string | null | undefined): StoredRoleStat[] {
  const raw = parseJson<{ stats?: unknown }>(payload);
  return asArray<StoredRoleStat>(raw?.stats);
}

/** One duo_slice payload: the slice-wide duo board. */
export function parseDuoSlice(payload: string | null | undefined): StoredDuo[] {
  const raw = parseJson<{ duos?: unknown }>(payload);
  return asArray<StoredDuo>(raw?.duos);
}

/* ------------------------------------------------------------------ *
 * Pure hydrators: payload entry + its slice key -> shared type
 * ------------------------------------------------------------------ */

export function mapChampion(r: ChampionRow): ChampionMeta {
  return { key: r.champion_key, id: r.id, name: r.name, title: r.title, roles: [] };
}

export function hydrateRoleStats(stat: StoredRoleStat, slice: Slice, role: Role): RoleStats {
  return {
    patch: slice.patch,
    region: slice.region,
    rank: slice.rank,
    role,
    championKey: stat.championKey,
    games: stat.games,
    wins: stat.wins,
    winRate: stat.winRate,
    pickRate: stat.pickRate,
    banRate: stat.banRate,
    wilsonLower: stat.wilsonLower,
    adjustedWinRate: stat.adjustedWinRate ?? null,
    playerPoolDelta: stat.playerPoolDelta ?? null,
    score: stat.score,
    tier: stat.tier as FullTierGrade,
    // Recomputed by getGradedRoleStats, which blends in the prior patch for
    // under-threshold champions; a bare hydrate has no prior to check against.
    provisional: false,
    deltaWinRate: null,
    deltaTier: null,
  };
}

export function hydrateMatchup(
  m: StoredMatchup,
  slice: Slice,
  role: Role,
  championKey: string,
): Matchup {
  return {
    patch: slice.patch,
    region: slice.region,
    rank: slice.rank,
    role,
    championKey,
    opponentKey: m.opponentKey,
    games: m.games,
    wins: m.wins,
    winRate: m.winRate,
    wilsonLower: m.wilsonLower,
  };
}

export function hydrateBuild(
  b: StoredBuild,
  slice: Slice,
  role: Role,
  championKey: string,
): BuildPath {
  return {
    patch: slice.patch,
    region: slice.region,
    rank: slice.rank,
    role,
    championKey,
    // '-' was the pre-0011 sentinel for "no opponent"; payloads write null, but
    // a backfilled row can still carry the sentinel through.
    opponentKey: b.opponentKey && b.opponentKey !== '-' ? b.opponentKey : null,
    items: asArray<number>(b.items),
    runes: asRunes(b.runes),
    games: b.games,
    wins: b.wins,
    winRate: b.winRate,
    slotOptions: b.slotOptions ?? null,
    bootOptions: b.bootOptions ?? null,
    spellOptions: b.spellOptions ?? null,
    coreOptions: b.coreOptions ?? null,
    startOptions: b.startOptions ?? null,
  };
}

export function hydrateKeystone(
  k: StoredKeystone,
  slice: Slice,
  role: Role,
  championKey: string,
): KeystoneStats {
  return {
    patch: slice.patch,
    region: slice.region,
    rank: slice.rank,
    role,
    championKey,
    keystone: k.keystone,
    games: k.games,
    wins: k.wins,
    winRate: k.winRate,
    wilsonLower: k.wilsonLower,
  };
}

export function hydrateRunePage(
  r: StoredRunePage,
  slice: Slice,
  role: Role,
  championKey: string,
): RunePageStats {
  return {
    patch: slice.patch,
    region: slice.region,
    rank: slice.rank,
    role,
    championKey,
    slot: r.slot as RunePageStats['slot'],
    runes: asRunes(r.runes),
    games: r.games,
    wins: r.wins,
    winRate: r.winRate,
    wilsonLower: r.wilsonLower,
  };
}

export function hydrateDuo(d: StoredDuo, slice: Slice): DuoSynergy {
  return {
    patch: slice.patch,
    region: slice.region,
    rank: slice.rank,
    adcKey: d.adcKey,
    supportKey: d.supportKey,
    games: d.games,
    wins: d.wins,
    winRate: d.winRate,
    wilsonLower: d.wilsonLower,
  };
}

export function mapCounter(r: CounterRow, tier: string | undefined): CounterPick {
  return {
    championKey: r.champion_key,
    winRate: r.win_rate,
    wilsonLower: r.wilson_lower,
    games: r.games,
    tier: (tier ?? 'D') as FullTierGrade,
  };
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
  return env.DB.prepare(
    'SELECT * FROM patches ORDER BY generated_at DESC LIMIT 1',
  ).first<PatchRow>();
}

/** The patch immediately before `patch`, if one is still on hand (the loader
 *  keeps a short retention window — see buildLoadSql). Null once none remains. */
async function getPreviousPatch(env: Env, patch: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT patch FROM patches WHERE patch != ? ORDER BY generated_at DESC LIMIT 1',
  )
    .bind(patch)
    .first<{ patch: string }>();
  return row?.patch ?? null;
}

/** One role's stored (ungraded) stats — a single row read on the primary key. */
async function fetchRoleSlice(
  env: Env,
  patch: string,
  region: Region,
  rank: RankBracket,
  role: Role,
): Promise<StoredRoleStat[]> {
  const row = await env.DB.prepare(
    'SELECT payload FROM role_slice WHERE patch = ? AND region = ? AND rank = ? AND role = ?',
  )
    .bind(patch, region, rank, role)
    .first<SliceRow>();
  return parseRoleSlice(row?.payload);
}

/** Every role a champion appears in for this slice — a primary-key prefix scan. */
async function fetchChampionRows(
  env: Env,
  slice: Slice,
  championKey: string,
): Promise<ChampionSliceRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT role, payload FROM champion_slice
     WHERE patch = ? AND region = ? AND rank = ? AND champion_key = ?`,
  )
    .bind(slice.patch, slice.region, slice.rank, championKey)
    .all<ChampionSliceRow>();
  return results;
}

/**
 * Everything one champion has in one slice, hydrated once and reused by the
 * champion page's five lists. Each call is ~5 row reads (one per role played).
 */
async function fetchChampionPayloads(
  env: Env,
  slice: Slice,
  championKey: string,
): Promise<{ role: Role; payload: ChampionPayload }[]> {
  const rows = await fetchChampionRows(env, slice, championKey);
  return rows.map((r) => ({ role: r.role as Role, payload: parseChampionPayload(r.payload) }));
}

/**
 * One role's slice, graded live: current-patch rows below TIER_LIST_MIN_GAMES
 * are blended with their prior-patch counterpart (see tier.ts) instead of
 * sitting out as NR while the new patch's sample fills up. Displayed games/
 * win rate/etc. stay the champion's real current-patch numbers — only the
 * ranking inputs and resulting tier/score/provisional are blended.
 */
async function getGradedRoleStats(env: Env, slice: Slice, role: Role): Promise<RoleStats[]> {
  const current = await fetchRoleSlice(env, slice.patch, slice.region, slice.rank, role);
  if (current.length === 0) return [];

  const priorPatch = await getPreviousPatch(env, slice.patch);
  const priorByChamp = new Map<string, StoredRoleStat>();
  if (priorPatch) {
    const prior = await fetchRoleSlice(env, priorPatch, slice.region, slice.rank, role);
    for (const stat of prior) priorByChamp.set(stat.championKey, stat);
  }

  const champions = await getChampions(env);
  const idByKey = new Map(champions.map((c) => [c.key, c.id]));

  const inputs: GradeInput[] = current.map((stat) => {
    const prior = priorByChamp.get(stat.championKey);
    return {
      winRate: stat.winRate,
      pickRate: stat.pickRate,
      banRate: stat.banRate,
      games: stat.games,
      wilsonLower: stat.wilsonLower,
      adjustedWinRate: stat.adjustedWinRate ?? null,
      skillFloor: skillFloorFor(idByKey.get(stat.championKey) ?? ''),
      priorPatch: prior
        ? {
            winRate: prior.winRate,
            pickRate: prior.pickRate,
            banRate: prior.banRate,
            wilsonLower: prior.wilsonLower,
            games: prior.games,
          }
        : undefined,
    };
  });

  const graded = gradeSlice(inputs);
  return current
    .map((stat, i) => ({
      ...hydrateRoleStats(stat, slice, role),
      tier: graded[i]!.grade,
      score: graded[i]!.score,
      provisional: graded[i]!.provisional,
    }))
    .sort((a, b) => b.score - a.score);
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

export async function getTierList(env: Env, slice: Slice, role: Role): Promise<RoleStats[]> {
  return getGradedRoleStats(env, slice, role);
}

export async function getRoleStatsForChampion(
  env: Env,
  slice: Slice,
  championKey: string,
): Promise<RoleStats[]> {
  const rows = await fetchChampionRows(env, slice, championKey);
  const roles = rows.map((r) => r.role as Role);

  const graded = await Promise.all(roles.map((role) => getGradedRoleStats(env, slice, role)));
  return graded
    .flat()
    .filter((r) => r.championKey === championKey)
    .sort((a, b) => b.games - a.games);
}

export async function getMatchupsForChampion(
  env: Env,
  slice: Slice,
  championKey: string,
): Promise<Matchup[]> {
  const rows = await fetchChampionPayloads(env, slice, championKey);
  return rows
    .flatMap(({ role, payload }) =>
      payload.matchups.map((m) => hydrateMatchup(m, slice, role, championKey)),
    )
    .sort((a, b) => b.games - a.games);
}

export async function getDuosForChampion(
  env: Env,
  slice: Slice,
  championKey: string,
): Promise<DuoSynergy[]> {
  const rows = await fetchChampionPayloads(env, slice, championKey);
  // A champion that plays both bot roles carries the same duo on both rows.
  const seen = new Set<string>();
  const duos: DuoSynergy[] = [];
  for (const { payload } of rows) {
    for (const d of payload.duos) {
      const key = `${d.adcKey}|${d.supportKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      duos.push(hydrateDuo(d, slice));
    }
  }
  return duos.sort((a, b) => b.games - a.games);
}

export async function getKeystonesForChampion(
  env: Env,
  slice: Slice,
  championKey: string,
): Promise<KeystoneStats[]> {
  const rows = await fetchChampionPayloads(env, slice, championKey);
  return rows
    .flatMap(({ role, payload }) =>
      payload.keystones.map((k) => hydrateKeystone(k, slice, role, championKey)),
    )
    .sort((a, b) => b.games - a.games);
}

export async function getRunePagesForChampion(
  env: Env,
  slice: Slice,
  championKey: string,
): Promise<RunePageStats[]> {
  const rows = await fetchChampionPayloads(env, slice, championKey);
  return rows
    .flatMap(({ role, payload }) =>
      payload.runePages.map((r) => hydrateRunePage(r, slice, role, championKey)),
    )
    .sort((a, b) => a.slot - b.slot);
}

export async function getBuildsForChampion(
  env: Env,
  slice: Slice,
  championKey: string,
): Promise<BuildPath[]> {
  const rows = await fetchChampionPayloads(env, slice, championKey);
  return rows
    .flatMap(({ role, payload }) =>
      payload.builds.map((b) => hydrateBuild(b, slice, role, championKey)),
    )
    .sort((a, b) => b.games - a.games);
}

export async function getDuos(env: Env, slice: Slice): Promise<DuoSynergy[]> {
  const row = await env.DB.prepare(
    'SELECT payload FROM duo_slice WHERE patch = ? AND region = ? AND rank = ?',
  )
    .bind(slice.patch, slice.region, slice.rank)
    .first<SliceRow>();
  // Stored pre-sorted and already capped at the board size.
  return parseDuoSlice(row?.payload).map((d) => hydrateDuo(d, slice));
}

/**
 * Counter picks: champions with the best record against `opponentKey` in `role`.
 *
 * The matchups live inside champion payloads, so this scans the slice's rows —
 * but json_each projects the matching matchup out in SQL, so only the 24 rows
 * that survive the sort cross the wire instead of every payload in the slice.
 */
export async function getCounters(
  env: Env,
  slice: Slice,
  role: Role,
  opponentKey: string,
): Promise<CounterPick[]> {
  const { results } = await env.DB.prepare(
    `SELECT cs.champion_key AS champion_key,
            CAST(json_extract(m.value, '$.games') AS INTEGER) AS games,
            json_extract(m.value, '$.winRate') AS win_rate,
            json_extract(m.value, '$.wilsonLower') AS wilson_lower
     FROM champion_slice cs,
          json_each(json_extract(cs.payload, '$.matchups')) m
     WHERE cs.patch = ? AND cs.region = ? AND cs.rank = ? AND cs.role = ?
       AND json_extract(m.value, '$.opponentKey') = ?
     ORDER BY wilson_lower DESC
     LIMIT 24`,
  )
    .bind(slice.patch, slice.region, slice.rank, role, opponentKey)
    .all<CounterRow>();
  if (results.length === 0) return [];

  // Tier comes from the stored (ungraded) role stats, as the pre-0011 join did.
  const stats = await fetchRoleSlice(env, slice.patch, slice.region, slice.rank, role);
  const tierByChamp = new Map(stats.map((stat) => [stat.championKey, stat.tier]));
  return results.map((r) => mapCounter(r, tierByChamp.get(r.champion_key)));
}
