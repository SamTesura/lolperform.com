/**
 * One-time cutover: build the migration-0011 slice rows out of the legacy
 * fan-out tables (role_stats, matchups, duos, builds, keystone_stats,
 * rune_pages) already loaded in D1, so the new Worker can be deployed without
 * waiting ~6 hours for the next crawl to finish.
 *
 * Why per-slice statements and not one big query: the whole-database form reads
 * ~800k rows and runs past D1's per-query time limit. Scoping every statement to
 * one (patch, region, rank) keeps each one small — a few hundred rows written,
 * a few thousand read — and lets a failed slice be retried on its own.
 *
 * Cost: one row written per champion-role, role slice and duo slice — about 19k
 * rows for a full patch, against the Workers Free ceiling of 100,000 per day.
 * Use --patches=1 to do only the current patch when the day's budget is tight;
 * the default of 2 also covers the prior patch the tier list blends for
 * provisional grades.
 *
 *   pnpm --filter @lolperform/pipeline backfill -- [--patches=2] [--dry-run] [--local]
 */
import { execFileSync } from 'node:child_process';
import { argv, exit } from 'node:process';
import { RANK_BRACKETS, REGIONS } from '@lolperform/shared';

const DB = 'lolperform';

/** Quote a SQL string literal. Every value here is one of our own constants. */
function q(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface BackfillStatements {
  championSlice: string;
  roleSlice: string;
  duoSlice: string;
}

/**
 * The three statements that rebuild one (patch, region, rank) slice.
 *
 * `loaded_at` is stamped 'backfill' so the next pipeline load — which stamps its
 * own generated_at and then prunes rows that do not carry it — replaces
 * everything this pass wrote.
 */
export function buildBackfillSql(patch: string, region: string, rank: string): BackfillStatements {
  const scope = `patch = ${q(patch)} AND region = ${q(region)} AND rank = ${q(rank)}`;
  const key = `k.patch = ${q(patch)} AND k.region = ${q(region)} AND k.rank = ${q(rank)}`;

  const championSlice = `
INSERT OR REPLACE INTO champion_slice (patch, region, rank, champion_key, role, payload, loaded_at)
SELECT k.patch, k.region, k.rank, k.champion_key, k.role,
  json_object(
    'matchups', COALESCE((
      SELECT json_group_array(json_object(
        'opponentKey', m.opponent_key, 'games', m.games, 'wins', m.wins,
        'winRate', m.win_rate, 'wilsonLower', m.wilson_lower))
      FROM matchups m
      WHERE m.patch = k.patch AND m.region = k.region AND m.rank = k.rank
        AND m.role = k.role AND m.champion_key = k.champion_key), json('[]')),
    'builds', COALESCE((
      SELECT json_group_array(json_object(
        'opponentKey', CASE WHEN b.opponent_key = '-' THEN NULL ELSE b.opponent_key END,
        'items', json(b.items), 'runes', json(b.runes),
        'games', b.games, 'wins', b.wins, 'winRate', b.win_rate,
        'slotOptions', json(b.slot_options), 'bootOptions', json(b.boot_options),
        'spellOptions', json(b.spell_options), 'coreOptions', json(b.core_options),
        'startOptions', json(b.start_options)))
      FROM builds b
      WHERE b.patch = k.patch AND b.region = k.region AND b.rank = k.rank
        AND b.role = k.role AND b.champion_key = k.champion_key), json('[]')),
    'keystones', COALESCE((
      SELECT json_group_array(json_object(
        'keystone', ks.keystone, 'games', ks.games, 'wins', ks.wins,
        'winRate', ks.win_rate, 'wilsonLower', ks.wilson_lower))
      FROM keystone_stats ks
      WHERE ks.patch = k.patch AND ks.region = k.region AND ks.rank = k.rank
        AND ks.role = k.role AND ks.champion_key = k.champion_key), json('[]')),
    'runePages', COALESCE((
      SELECT json_group_array(json_object(
        'slot', rp.slot, 'runes', json(rp.runes), 'games', rp.games, 'wins', rp.wins,
        'winRate', rp.win_rate, 'wilsonLower', rp.wilson_lower))
      FROM rune_pages rp
      WHERE rp.patch = k.patch AND rp.region = k.region AND rp.rank = k.rank
        AND rp.role = k.role AND rp.champion_key = k.champion_key), json('[]')),
    'duos', COALESCE((
      SELECT json_group_array(json_object(
        'adcKey', d.adc_key, 'supportKey', d.support_key, 'games', d.games,
        'wins', d.wins, 'winRate', d.win_rate, 'wilsonLower', d.wilson_lower))
      FROM duos d
      WHERE d.patch = k.patch AND d.region = k.region AND d.rank = k.rank
        AND ((k.role = 'BOTTOM' AND d.adc_key = k.champion_key)
          OR (k.role = 'UTILITY' AND d.support_key = k.champion_key))), json('[]'))
  ),
  'backfill'
FROM (
  SELECT patch, region, rank, role, champion_key FROM role_stats WHERE ${scope}
  UNION SELECT patch, region, rank, role, champion_key FROM matchups WHERE ${scope}
  UNION SELECT patch, region, rank, role, champion_key FROM builds WHERE ${scope}
  UNION SELECT patch, region, rank, role, champion_key FROM keystone_stats WHERE ${scope}
  UNION SELECT patch, region, rank, role, champion_key FROM rune_pages WHERE ${scope}
  UNION SELECT patch, region, rank, 'BOTTOM', adc_key FROM duos WHERE ${scope}
  UNION SELECT patch, region, rank, 'UTILITY', support_key FROM duos WHERE ${scope}
) k
WHERE ${key}`.trim();

  const roleSlice = `
INSERT OR REPLACE INTO role_slice (patch, region, rank, role, payload, loaded_at)
SELECT patch, region, rank, role,
  json_object('stats', json_group_array(json_object(
    'championKey', champion_key, 'games', games, 'wins', wins, 'winRate', win_rate,
    'pickRate', pick_rate, 'banRate', ban_rate, 'wilsonLower', wilson_lower,
    'adjustedWinRate', adjusted_win_rate, 'playerPoolDelta', player_pool_delta,
    'score', score, 'tier', tier))),
  'backfill'
FROM role_stats WHERE ${scope}
GROUP BY patch, region, rank, role`.trim();

  // Capped at the 500 rows /api/v1/duos serves, matching the loader.
  const duoSlice = `
INSERT OR REPLACE INTO duo_slice (patch, region, rank, payload, loaded_at)
SELECT ${q(patch)}, ${q(region)}, ${q(rank)},
  json_object('duos', COALESCE(json_group_array(json_object(
    'adcKey', adc_key, 'supportKey', support_key, 'games', games, 'wins', wins,
    'winRate', win_rate, 'wilsonLower', wilson_lower)), json('[]'))),
  'backfill'
FROM (SELECT * FROM duos WHERE ${scope} ORDER BY games DESC LIMIT 500)`.trim();

  return { championSlice, roleSlice, duoSlice };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

interface Options {
  patches: number;
  dryRun: boolean;
  local: boolean;
}

export function parseOptions(args: readonly string[]): Options {
  const flags = new Map<string, string>();
  for (const arg of args) {
    const [name, value] = arg.replace(/^--/, '').split('=');
    if (name) flags.set(name, value ?? 'true');
  }
  const patches = Number(flags.get('patches') ?? 2);
  return {
    patches: Number.isFinite(patches) && patches > 0 ? Math.floor(patches) : 2,
    dryRun: flags.has('dry-run'),
    local: flags.has('local'),
  };
}

function wrangler(options: Options, args: readonly string[]): string {
  return execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', DB, options.local ? '--local' : '--remote', ...args],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

function query<T>(options: Options, sql: string): T[] {
  const out = wrangler(options, ['--json', '--command', sql]);
  // wrangler prints a banner before the JSON payload.
  const parsed = JSON.parse(out.slice(out.indexOf('['))) as { results?: T[] }[];
  return parsed[0]?.results ?? [];
}

async function main(): Promise<void> {
  const options = parseOptions(argv.slice(2));
  const patches = query<{ patch: string }>(
    options,
    `SELECT patch FROM patches ORDER BY generated_at DESC LIMIT ${options.patches}`,
  ).map((r) => r.patch);

  if (patches.length === 0) {
    console.error('[backfill] no patches in D1 — nothing to backfill');
    exit(1);
  }
  console.info(`[backfill] patches: ${patches.join(', ')}`);

  for (const patch of patches) {
    for (const rank of RANK_BRACKETS) {
      for (const region of REGIONS) {
        const label = `${patch} ${region}/${rank}`;
        const statements = buildBackfillSql(patch, region, rank);
        if (options.dryRun) {
          console.info(`[backfill] (dry run) ${label}`);
          continue;
        }
        for (const [name, statement] of Object.entries(statements)) {
          try {
            wrangler(options, ['--command', statement]);
          } catch (err) {
            console.error(`[backfill] FAILED ${label} ${name}`);
            throw err;
          }
        }
        console.info(`[backfill] ok ${label}`);
      }
    }
  }

  const [counts] = query<{ c: number; r: number; d: number }>(
    options,
    `SELECT (SELECT COUNT(*) FROM champion_slice) c,
            (SELECT COUNT(*) FROM role_slice) r,
            (SELECT COUNT(*) FROM duo_slice) d`,
  );
  console.info(
    `[backfill] done — ${counts?.c ?? '?'} champion_slice, ${counts?.r ?? '?'} role_slice, ` +
      `${counts?.d ?? '?'} duo_slice rows`,
  );
}

const isMain = !!argv[1] && argv[1].endsWith('backfill.ts');
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    exit(1);
  });
}
