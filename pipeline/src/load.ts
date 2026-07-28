import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import type {
  BuildPath,
  ChampionMeta,
  DuoSynergy,
  Matchup,
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

/** Build a chunked multi-row INSERT for one table. */
function insertRows(table: string, columns: string[], rows: string[][], chunk = 100): string {
  if (rows.length === 0) return '';
  const cols = columns.join(', ');
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const values = rows
      .slice(i, i + chunk)
      .map((r) => `(${r.join(', ')})`)
      .join(',\n  ');
    out.push(`INSERT OR REPLACE INTO ${table} (${cols}) VALUES\n  ${values};`);
  }
  return out.join('\n');
}

/**
 * Build the SQL that loads one patch's dataset into D1. Idempotent: it clears the
 * patch's existing rows first, so re-running a patch is safe. All values are
 * escaped here — the pipeline is the only writer, but we never trust string data
 * (champion names) into raw SQL regardless.
 */
export function buildLoadSql(input: LoadInput): string {
  const { meta } = input;
  const patch = s(meta.patch);
  const parts: string[] = ['PRAGMA foreign_keys = ON;'];

  for (const table of ['role_stats', 'matchups', 'duos', 'builds']) {
    parts.push(`DELETE FROM ${table} WHERE patch = ${patch};`);
  }
  parts.push(`DELETE FROM patches WHERE patch = ${patch};`);
  parts.push('DELETE FROM champions;');

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

  parts.push(
    insertRows(
      'role_stats',
      [
        'patch', 'region', 'rank', 'role', 'champion_key',
        'games', 'wins', 'win_rate', 'pick_rate', 'ban_rate',
        'wilson_lower', 'score', 'tier', 'adjusted_win_rate', 'player_pool_delta',
      ],
      input.roleStats.map((r) => [
        s(r.patch), s(r.region), s(r.rank), s(r.role), s(r.championKey),
        n(r.games), n(r.wins), n(r.winRate), n(r.pickRate), n(r.banRate),
        n(r.wilsonLower), n(r.score), s(r.tier),
        r.adjustedWinRate == null ? 'NULL' : n(r.adjustedWinRate),
        r.playerPoolDelta == null ? 'NULL' : n(r.playerPoolDelta),
      ]),
    ),
  );

  parts.push(
    insertRows(
      'matchups',
      ['patch', 'region', 'rank', 'role', 'champion_key', 'opponent_key', 'games', 'wins', 'win_rate', 'wilson_lower'],
      input.matchups.map((m) => [
        s(m.patch), s(m.region), s(m.rank), s(m.role), s(m.championKey), s(m.opponentKey),
        n(m.games), n(m.wins), n(m.winRate), n(m.wilsonLower),
      ]),
    ),
  );

  parts.push(
    insertRows(
      'duos',
      ['patch', 'region', 'rank', 'adc_key', 'support_key', 'games', 'wins', 'win_rate', 'wilson_lower'],
      input.duos.map((d) => [
        s(d.patch), s(d.region), s(d.rank), s(d.adcKey), s(d.supportKey),
        n(d.games), n(d.wins), n(d.winRate), n(d.wilsonLower),
      ]),
    ),
  );

  parts.push(
    insertRows(
      'builds',
      ['patch', 'region', 'rank', 'role', 'champion_key', 'opponent_key', 'items', 'runes', 'games', 'wins', 'win_rate'],
      input.builds.map((b) => [
        s(b.patch), s(b.region), s(b.rank), s(b.role), s(b.championKey),
        s(b.opponentKey ?? '-'), s(JSON.stringify(b.items)), s(JSON.stringify(b.runes)),
        n(b.games), n(b.wins), n(b.winRate),
      ]),
    ),
  );

  return parts.filter(Boolean).join('\n\n') + '\n';
}

const DATA_DIR = new URL('../data/latest/', import.meta.url);
const OUT_FILE = new URL('../../db/.generated/load.sql', import.meta.url);

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(name, DATA_DIR), 'utf8')) as T;
}

async function main(): Promise<void> {
  const input: LoadInput = {
    meta: await readJson<DatasetMetaFile>('dataset-meta.json'),
    champions: await readJson<ChampionMeta[]>('champions.json'),
    roleStats: await readJson<RoleStats[]>('role-stats.json'),
    matchups: await readJson<Matchup[]>('matchups.json'),
    duos: await readJson<DuoSynergy[]>('duos.json'),
    builds: await readJson<BuildPath[]>('builds.json'),
  };
  const sql = buildLoadSql(input);
  await mkdir(new URL('../../db/.generated/', import.meta.url), { recursive: true });
  await writeFile(OUT_FILE, sql, 'utf8');
  console.info(
    `[load] wrote db/.generated/load.sql ` +
      `(${input.roleStats.length} role rows, ${input.matchups.length} matchups, ` +
      `${input.duos.length} duos, ${input.builds.length} builds)`,
  );
}

const isMain = !!argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
