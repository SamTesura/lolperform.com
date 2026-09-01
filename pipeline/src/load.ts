import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import type {
  BuildPath,
  ChampionMeta,
  DuoSynergy,
  Matchup,
  KeystoneStats,
  RunePageStats,
  RoleStats,
} from '@lolperform/shared';

export interface DatasetMetaFile {
  patch: string;
  version: string;
  generatedAt: string;
  totalMatches: number;
}

export interface LoadInput {
  meta: DatasetMetaFile;
  champions: ChampionMeta[];
  roleStats: RoleStats[];
  keystones: KeystoneStats[];
  runePages: RunePageStats[];
  matchups: Matchup[];
  duos: DuoSynergy[];
  builds: BuildPath[];
}

/** Quote and escape a string literal for SQLite. */
function s(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Emit a finite number, or 0 — never an injection vector or NaN. */
function n(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

/** D1 rejects any single statement over 100 KB (SQLITE_TOOBIG). Slice payloads
 *  are JSON documents, so chunks are capped by bytes as well as row count. */
const MAX_STATEMENT_BYTES = 80_000;

/** Ceiling for one payload, leaving room for the INSERT head and key columns
 *  inside a single-row statement. Payloads over this are trimmed
 *  lowest-sample-first rather than emitted and rejected by D1. */
const MAX_PAYLOAD_BYTES = 60_000;

/** How many patches of slice rows to keep. The Worker needs the current patch
 *  plus the one before it (provisional grading blends the prior patch); the
 *  third is slack for a patch that rolls over mid-run. Older patches are pruned
 *  so storage does not grow without bound. */
const RETAIN_PATCHES = 3;

/** Duos served by /api/v1/duos — the endpoint's own LIMIT, applied at load time
 *  so the slice-wide board is a single row read. */
const DUO_BOARD_LIMIT = 500;

/** Build a multi-row INSERT for one table, chunked by row count and bytes. */
function insertRows(table: string, columns: string[], rows: string[][], chunk = 100): string {
  if (rows.length === 0) return '';
  const head = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES\n  `;
  const out: string[] = [];
  let batch: string[] = [];
  let bytes = head.length;
  const flush = () => {
    if (batch.length > 0) out.push(head + batch.join(',\n  ') + ';');
    batch = [];
    bytes = head.length;
  };
  for (const r of rows) {
    const value = `(${r.join(', ')})`;
    const added = Buffer.byteLength(value, 'utf8') + 4; // separator slack
    if (batch.length > 0 && (batch.length >= chunk || bytes + added > MAX_STATEMENT_BYTES)) flush();
    batch.push(value);
    bytes += added;
  }
  flush();
  return out.join('\n');
}

/* ------------------------------------------------------------------ *
 * Payload shapes — what a slice row carries, minus the key columns it
 * is already stored under. Mirrored by the parsers in worker/src/db.ts.
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
  runes: BuildPath['runes'];
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
  runes: RunePageStats['runes'];
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

function championRowKey(region: string, rank: string, championKey: string, role: string): string {
  return `${region} ${rank} ${championKey} ${role}`;
}

function emptyPayload(): ChampionPayload {
  return { matchups: [], builds: [], keystones: [], runePages: [], duos: [] };
}

/**
 * Shrink an oversized payload instead of emitting a statement D1 will reject.
 * Order of sacrifice is least-defensible-first: the lowest-sample matchups go
 * before anything a champion page shows above the fold, and build option arrays
 * (the heaviest fields by far) go before the builds themselves.
 */
export function trimPayload(
  payload: ChampionPayload,
  maxBytes = MAX_PAYLOAD_BYTES,
): ChampionPayload {
  const size = (p: ChampionPayload) => Buffer.byteLength(JSON.stringify(p), 'utf8');
  if (size(payload) <= maxBytes) return payload;

  const trimmed: ChampionPayload = {
    ...payload,
    matchups: [...payload.matchups].sort((a, b) => b.games - a.games),
    builds: [...payload.builds].sort((a, b) => b.games - a.games),
  };

  // 1. Drop the thinnest matchups, keeping at least the top 10.
  while (size(trimmed) > maxBytes && trimmed.matchups.length > 10) trimmed.matchups.pop();

  // 2. Strip build option arrays, biggest consumer first.
  const optionFields = [
    'startOptions',
    'coreOptions',
    'slotOptions',
    'spellOptions',
    'bootOptions',
  ] as const;
  for (const field of optionFields) {
    if (size(trimmed) <= maxBytes) break;
    trimmed.builds = trimmed.builds.map((b) => ({ ...b, [field]: null }));
  }

  // 3. Last resort: the most-played build and as many matchups as still fit.
  if (size(trimmed) > maxBytes) trimmed.builds = trimmed.builds.slice(0, 1);
  while (size(trimmed) > maxBytes && trimmed.matchups.length > 1) trimmed.matchups.pop();

  return trimmed;
}

/** Group every per-champion record into one payload per (region, rank, champion, role). */
export function groupChampionPayloads(input: LoadInput): Map<string, ChampionPayload> {
  const rows = new Map<string, ChampionPayload>();
  const at = (region: string, rank: string, championKey: string, role: string): ChampionPayload => {
    const key = championRowKey(region, rank, championKey, role);
    let payload = rows.get(key);
    if (!payload) {
      payload = emptyPayload();
      rows.set(key, payload);
    }
    return payload;
  };

  for (const m of input.matchups) {
    at(m.region, m.rank, m.championKey, m.role).matchups.push({
      opponentKey: m.opponentKey,
      games: m.games,
      wins: m.wins,
      winRate: m.winRate,
      wilsonLower: m.wilsonLower,
    });
  }
  for (const b of input.builds) {
    at(b.region, b.rank, b.championKey, b.role).builds.push({
      opponentKey: b.opponentKey ?? null,
      items: b.items,
      runes: b.runes,
      games: b.games,
      wins: b.wins,
      winRate: b.winRate,
      slotOptions: b.slotOptions ?? null,
      bootOptions: b.bootOptions ?? null,
      spellOptions: b.spellOptions ?? null,
      coreOptions: b.coreOptions ?? null,
      startOptions: b.startOptions ?? null,
    });
  }
  for (const k of input.keystones) {
    at(k.region, k.rank, k.championKey, k.role).keystones.push({
      keystone: k.keystone,
      games: k.games,
      wins: k.wins,
      winRate: k.winRate,
      wilsonLower: k.wilsonLower,
    });
  }
  for (const r of input.runePages) {
    at(r.region, r.rank, r.championKey, r.role).runePages.push({
      slot: r.slot,
      runes: r.runes,
      games: r.games,
      wins: r.wins,
      winRate: r.winRate,
      wilsonLower: r.wilsonLower,
    });
  }
  // A duo has no role of its own: file it under the ADC's BOTTOM row and the
  // support's UTILITY row, which is the pair of rows the champion page reads
  // back for either champion.
  for (const d of input.duos) {
    const duo: StoredDuo = {
      adcKey: d.adcKey,
      supportKey: d.supportKey,
      games: d.games,
      wins: d.wins,
      winRate: d.winRate,
      wilsonLower: d.wilsonLower,
    };
    at(d.region, d.rank, d.adcKey, 'BOTTOM').duos.push(duo);
    at(d.region, d.rank, d.supportKey, 'UTILITY').duos.push(duo);
  }
  // Every champion with role stats gets a row even when nothing else attached,
  // so the champion page can tell "no data" from "not loaded".
  for (const r of input.roleStats) at(r.region, r.rank, r.championKey, r.role);

  return rows;
}

/** One row per (region, rank, role): the slice's ungraded role stats. */
export function groupRoleSlices(roleStats: RoleStats[]): Map<string, StoredRoleStat[]> {
  const rows = new Map<string, StoredRoleStat[]>();
  for (const r of roleStats) {
    const key = `${r.region} ${r.rank} ${r.role}`;
    let list = rows.get(key);
    if (!list) {
      list = [];
      rows.set(key, list);
    }
    list.push({
      championKey: r.championKey,
      games: r.games,
      wins: r.wins,
      winRate: r.winRate,
      pickRate: r.pickRate,
      banRate: r.banRate,
      wilsonLower: r.wilsonLower,
      adjustedWinRate: r.adjustedWinRate,
      playerPoolDelta: r.playerPoolDelta,
      score: r.score,
      tier: r.tier,
    });
  }
  return rows;
}

/** One row per (region, rank): the slice-wide duo board, pre-sorted and capped. */
export function groupDuoSlices(duos: DuoSynergy[]): Map<string, StoredDuo[]> {
  const rows = new Map<string, StoredDuo[]>();
  for (const d of duos) {
    const key = `${d.region} ${d.rank}`;
    let list = rows.get(key);
    if (!list) {
      list = [];
      rows.set(key, list);
    }
    list.push({
      adcKey: d.adcKey,
      supportKey: d.supportKey,
      games: d.games,
      wins: d.wins,
      winRate: d.winRate,
      wilsonLower: d.wilsonLower,
    });
  }
  for (const [key, list] of rows) {
    rows.set(key, list.sort((a, b) => b.games - a.games).slice(0, DUO_BOARD_LIMIT));
  }
  return rows;
}

/**
 * Build the SQL that loads one patch's dataset into D1.
 *
 * Idempotent without a delete-everything pass: rows are upserted by primary key
 * and stamped with this run's `generated_at`, then any row of this patch left
 * over from an earlier run is pruned. On the Workers Free plan a DELETE costs a
 * row write exactly like an INSERT, so clearing the patch first doubled the bill
 * for data that was about to be rewritten anyway.
 *
 * All values are escaped here — the pipeline is the only writer, but we never
 * trust string data (champion names) into raw SQL regardless.
 */
export function buildLoadSql(input: LoadInput): string {
  const { meta } = input;
  const patch = s(meta.patch);
  const run = s(meta.generatedAt);
  const parts: string[] = ['PRAGMA foreign_keys = ON;'];

  parts.push(
    insertRows(
      'patches',
      ['patch', 'version', 'generated_at', 'total_matches'],
      [[patch, s(meta.version), s(meta.generatedAt), n(meta.totalMatches)]],
    ),
  );

  parts.push(
    insertRows(
      'champions',
      ['champion_key', 'id', 'name', 'title', 'version'],
      input.champions.map((c) => [s(c.key), s(c.id), s(c.name), s(c.title), s(meta.version)]),
    ),
  );

  const championRows: string[][] = [];
  for (const [key, payload] of groupChampionPayloads(input)) {
    const [region, rank, championKey, role] = key.split(' ');
    championRows.push([
      patch,
      s(region!),
      s(rank!),
      s(championKey!),
      s(role!),
      s(JSON.stringify(trimPayload(payload))),
      run,
    ]);
  }
  parts.push(
    insertRows(
      'champion_slice',
      ['patch', 'region', 'rank', 'champion_key', 'role', 'payload', 'loaded_at'],
      championRows,
    ),
  );

  const roleRows: string[][] = [];
  for (const [key, stats] of groupRoleSlices(input.roleStats)) {
    const [region, rank, role] = key.split(' ');
    roleRows.push([patch, s(region!), s(rank!), s(role!), s(JSON.stringify({ stats })), run]);
  }
  parts.push(
    insertRows('role_slice', ['patch', 'region', 'rank', 'role', 'payload', 'loaded_at'], roleRows),
  );

  const duoRows: string[][] = [];
  for (const [key, duos] of groupDuoSlices(input.duos)) {
    const [region, rank] = key.split(' ');
    duoRows.push([patch, s(region!), s(rank!), s(JSON.stringify({ duos })), run]);
  }
  parts.push(insertRows('duo_slice', ['patch', 'region', 'rank', 'payload', 'loaded_at'], duoRows));

  // Rows this run did not rewrite are keys that no longer exist (a champion that
  // fell out of a role, an opponent that stopped appearing). Only they are
  // deleted, so the prune costs a write per genuinely dead row.
  for (const table of ['champion_slice', 'role_slice', 'duo_slice']) {
    parts.push(`DELETE FROM ${table} WHERE patch = ${patch} AND loaded_at <> ${run};`);
  }

  // Retention: keep the newest RETAIN_PATCHES patches. Slice rows first, then the
  // patches rows themselves, so the subquery still names the survivors.
  const survivors = `SELECT patch FROM (SELECT patch FROM patches ORDER BY generated_at DESC LIMIT ${RETAIN_PATCHES})`;
  for (const table of ['champion_slice', 'role_slice', 'duo_slice']) {
    parts.push(`DELETE FROM ${table} WHERE patch NOT IN (${survivors});`);
  }
  parts.push(`DELETE FROM patches WHERE patch NOT IN (${survivors});`);

  return parts.filter(Boolean).join('\n\n') + '\n';
}

/** What one load will cost against the Workers Free daily write ceiling. */
export function estimateRowWrites(input: LoadInput): number {
  return (
    1 +
    input.champions.length +
    groupChampionPayloads(input).size +
    groupRoleSlices(input.roleStats).size +
    groupDuoSlices(input.duos).size
  );
}

const DATA_DIR = new URL('../data/latest/', import.meta.url);
const OUT_FILE = new URL('../../db/.generated/load.sql', import.meta.url);

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(name, DATA_DIR), 'utf8')) as T;
}

/** Same, but a missing file yields a fallback instead of aborting the load.
 *  A dataset written before this table existed should still load everything
 *  else rather than costing the whole D1 update. */
async function readJsonOr<T>(name: string, fallback: T): Promise<T> {
  try {
    return await readJson<T>(name);
  } catch {
    console.warn(`[load] ${name} missing — loading without it`);
    return fallback;
  }
}

async function main(): Promise<void> {
  const input: LoadInput = {
    meta: await readJson<DatasetMetaFile>('dataset-meta.json'),
    champions: await readJson<ChampionMeta[]>('champions.json'),
    roleStats: await readJson<RoleStats[]>('role-stats.json'),
    keystones: await readJsonOr<KeystoneStats[]>('keystones.json', []),
    runePages: await readJsonOr<RunePageStats[]>('rune-pages.json', []),
    matchups: await readJson<Matchup[]>('matchups.json'),
    duos: await readJson<DuoSynergy[]>('duos.json'),
    builds: await readJson<BuildPath[]>('builds.json'),
  };
  const sql = buildLoadSql(input);
  await mkdir(new URL('../../db/.generated/', import.meta.url), { recursive: true });
  await writeFile(OUT_FILE, sql, 'utf8');
  const writes = estimateRowWrites(input);
  console.info(
    `[load] wrote db/.generated/load.sql ` +
      `(${input.roleStats.length} role rows, ${input.matchups.length} matchups, ` +
      `${input.duos.length} duos, ${input.builds.length} builds ` +
      `-> ~${writes.toLocaleString('en-US')} D1 rows written, ` +
      `${((writes / 100_000) * 100).toFixed(1)}% of the free daily ceiling)`,
  );
}

const isMain = !!argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
