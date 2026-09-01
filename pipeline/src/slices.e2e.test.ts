/**
 * End-to-end check of the storage layer: applies the real migrations to a real
 * SQLite engine, then runs the SQL the loader, the backfill and the Worker
 * actually emit. The unit tests assert on SQL strings; this asserts the engine
 * accepts them — WITHOUT ROWID, the CHECK constraints, json_each and all.
 *
 * Skipped unless node:sqlite is available (Node 22 needs
 * `NODE_OPTIONS=--experimental-sqlite`, Node 23+ has it unflagged), so a runner
 * without it stays green.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLoadSql, type LoadInput } from './load.js';
import { buildBackfillSql } from './backfill.js';
import type { DatabaseSync } from 'node:sqlite';

interface Sqlite {
  DatabaseSync: typeof DatabaseSync;
}
type Db = InstanceType<typeof DatabaseSync>;

let sqlite: Sqlite | null = null;
try {
  sqlite = await import('node:sqlite');
} catch {
  sqlite = null;
}
const withSqlite = sqlite ? describe : describe.skip;

const MIGRATIONS = new URL('../../db/migrations/', import.meta.url);

function freshDb(): Db {
  const db = new sqlite!.DatabaseSync(':memory:');
  for (const f of readdirSync(MIGRATIONS).sort()) {
    db.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
  }
  return db;
}

const runes = {
  keystone: 8008,
  primaryStyle: 8000,
  subStyle: 8200,
  primary: [8008],
  secondary: [8226],
  shards: [5005, 5008, 5001],
};

function input(patch: string, generatedAt: string): LoadInput {
  const slice = { patch, region: 'na1' as const, rank: 'emerald_plus' as const };
  return {
    meta: { patch, version: `${patch}.1`, generatedAt, totalMatches: 1000 },
    champions: [
      { key: '145', id: 'Kaisa', name: "Kai'Sa", title: 'Daughter of the Void', roles: [] },
      { key: '412', id: 'Thresh', name: 'Thresh', title: 'the Chain Warden', roles: [] },
      { key: '51', id: 'Caitlyn', name: 'Caitlyn', title: 'the Sheriff', roles: [] },
    ],
    roleStats: ['145', '51'].map((championKey, i) => ({
      ...slice,
      role: 'BOTTOM' as const,
      championKey,
      games: 800 - i,
      wins: 420,
      winRate: 0.525,
      pickRate: 0.2,
      banRate: 0.05,
      adjustedWinRate: null,
      playerPoolDelta: null,
      wilsonLower: 0.49,
      score: 0.49,
      tier: 'S' as const,
      provisional: false,
      deltaWinRate: null,
      deltaTier: null,
    })),
    matchups: [
      {
        ...slice,
        role: 'BOTTOM' as const,
        championKey: '145',
        opponentKey: '51',
        games: 120,
        wins: 70,
        winRate: 0.583,
        wilsonLower: 0.52,
      },
      {
        ...slice,
        role: 'BOTTOM' as const,
        championKey: '51',
        opponentKey: '145',
        games: 120,
        wins: 50,
        winRate: 0.416,
        wilsonLower: 0.36,
      },
    ],
    duos: [
      {
        ...slice,
        adcKey: '145',
        supportKey: '412',
        games: 90,
        wins: 50,
        winRate: 0.555,
        wilsonLower: 0.46,
      },
    ],
    builds: [
      {
        ...slice,
        role: 'BOTTOM' as const,
        championKey: '145',
        opponentKey: null,
        items: [3006, 6672, 3094],
        runes,
        games: 300,
        wins: 165,
        winRate: 0.55,
        slotOptions: [[{ item: 6672, share: 0.62, games: 186 }]],
        bootOptions: null,
        spellOptions: null,
        coreOptions: null,
        startOptions: null,
      },
    ],
    keystones: [
      {
        ...slice,
        role: 'BOTTOM' as const,
        championKey: '145',
        keystone: 8008,
        games: 420,
        wins: 231,
        winRate: 0.55,
        wilsonLower: 0.5,
      },
    ],
    runePages: [
      {
        ...slice,
        role: 'BOTTOM' as const,
        championKey: '145',
        slot: 1 as const,
        runes,
        games: 380,
        wins: 209,
        winRate: 0.55,
        wilsonLower: 0.5,
      },
    ],
  };
}

withSqlite('generated load SQL against real SQLite', () => {
  it('applies cleanly and folds the fan-out into slice rows', () => {
    const db = freshDb();
    db.exec(buildLoadSql(input('16.12', '2026-06-17T00:00:00.000Z')));

    const counts = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM champion_slice) c,
                (SELECT COUNT(*) FROM role_slice) r,
                (SELECT COUNT(*) FROM duo_slice) d,
                (SELECT COUNT(*) FROM patches) p`,
      )
      .get() as Record<string, number>;
    // 145/BOTTOM, 51/BOTTOM, 412/UTILITY
    expect(counts.c).toBe(3);
    expect(counts.r).toBe(1);
    expect(counts.d).toBe(1);
    expect(counts.p).toBe(1);

    const row = db
      .prepare(
        `SELECT payload FROM champion_slice
         WHERE patch='16.12' AND region='na1' AND rank='emerald_plus'
           AND champion_key='145' AND role='BOTTOM'`,
      )
      .get() as { payload: string };
    const payload = JSON.parse(row.payload);
    expect(payload.matchups).toHaveLength(1);
    expect(payload.builds[0].items).toEqual([3006, 6672, 3094]);
    expect(payload.keystones[0].games).toBe(420);
    expect(payload.runePages[0].slot).toBe(1);
    expect(payload.duos[0].supportKey).toBe('412');
  });

  it('is idempotent and prunes rows a previous run left behind', () => {
    const db = freshDb();
    db.exec(buildLoadSql(input('16.12', '2026-06-17T00:00:00.000Z')));

    // Second run of the same patch, with champion 51 gone from the dataset.
    const second = input('16.12', '2026-06-17T06:00:00.000Z');
    second.roleStats = second.roleStats.filter((r) => r.championKey !== '51');
    second.matchups = second.matchups.filter((m) => m.championKey !== '51');
    db.exec(buildLoadSql(second));

    const keys = db
      .prepare('SELECT champion_key, role FROM champion_slice ORDER BY champion_key')
      .all() as { champion_key: string }[];
    expect(keys.map((k) => k.champion_key)).toEqual(['145', '412']);
    const stats = JSON.parse(
      (db.prepare('SELECT payload FROM role_slice').get() as { payload: string }).payload,
    );
    expect(stats.stats).toHaveLength(1);
  });

  it('keeps only the retained patches', () => {
    const db = freshDb();
    for (const [i, patch] of ['16.09', '16.10', '16.11', '16.12'].entries()) {
      db.exec(buildLoadSql(input(patch, `2026-06-1${i}T00:00:00.000Z`)));
    }
    const patches = (
      db.prepare('SELECT patch FROM patches ORDER BY patch').all() as {
        patch: string;
      }[]
    ).map((p) => p.patch);
    expect(patches).toEqual(['16.10', '16.11', '16.12']);
    const orphans = db
      .prepare("SELECT COUNT(*) n FROM champion_slice WHERE patch = '16.09'")
      .get() as { n: number };
    expect(orphans.n).toBe(0);
  });

  it("serves the worker's counter-pick query out of the payloads", () => {
    const db = freshDb();
    db.exec(buildLoadSql(input('16.12', '2026-06-17T00:00:00.000Z')));
    const rows = db
      .prepare(
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
      .all('16.12', 'na1', 'emerald_plus', 'BOTTOM', '51') as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.champion_key).toBe('145');
    expect(rows[0]!.games).toBe(120);
    expect(rows[0]!.wilson_lower).toBeCloseTo(0.52);
  });
});

withSqlite('backfill from the legacy tables', () => {
  it('reproduces the same payloads the loader would write', () => {
    const db = freshDb();
    // Populate the legacy tables the way the pre-0011 loader did.
    const legacy = input('16.12', '2026-06-17T00:00:00.000Z');
    db.exec(`INSERT INTO patches VALUES ('16.12','16.12.1','2026-06-17T00:00:00.000Z',1000)`);
    for (const c of legacy.champions) {
      db.prepare('INSERT INTO champions VALUES (?,?,?,?,?)').run(
        c.key,
        c.id,
        c.name,
        c.title,
        '16.12.1',
      );
    }
    for (const r of legacy.roleStats) {
      db.prepare(
        'INSERT INTO role_stats (patch,region,rank,role,champion_key,games,wins,win_rate,pick_rate,ban_rate,wilson_lower,score,tier,adjusted_win_rate,player_pool_delta) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ).run(
        r.patch,
        r.region,
        r.rank,
        r.role,
        r.championKey,
        r.games,
        r.wins,
        r.winRate,
        r.pickRate,
        r.banRate,
        r.wilsonLower,
        r.score,
        r.tier,
        null,
        null,
      );
    }
    for (const m of legacy.matchups) {
      db.prepare('INSERT INTO matchups VALUES (?,?,?,?,?,?,?,?,?,?)').run(
        m.patch,
        m.region,
        m.rank,
        m.role,
        m.championKey,
        m.opponentKey,
        m.games,
        m.wins,
        m.winRate,
        m.wilsonLower,
      );
    }
    for (const d of legacy.duos) {
      db.prepare('INSERT INTO duos VALUES (?,?,?,?,?,?,?,?,?)').run(
        d.patch,
        d.region,
        d.rank,
        d.adcKey,
        d.supportKey,
        d.games,
        d.wins,
        d.winRate,
        d.wilsonLower,
      );
    }
    for (const b of legacy.builds) {
      db.prepare(
        'INSERT INTO builds (patch,region,rank,role,champion_key,opponent_key,items,runes,games,wins,win_rate,slot_options,boot_options,spell_options,core_options,start_options) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ).run(
        b.patch,
        b.region,
        b.rank,
        b.role,
        b.championKey,
        '-',
        JSON.stringify(b.items),
        JSON.stringify(b.runes),
        b.games,
        b.wins,
        b.winRate,
        JSON.stringify(b.slotOptions),
        null,
        null,
        null,
        null,
      );
    }
    for (const k of legacy.keystones) {
      db.prepare('INSERT INTO keystone_stats VALUES (?,?,?,?,?,?,?,?,?,?)').run(
        k.patch,
        k.region,
        k.rank,
        k.role,
        k.championKey,
        k.keystone,
        k.games,
        k.wins,
        k.winRate,
        k.wilsonLower,
      );
    }
    for (const r of legacy.runePages) {
      db.prepare('INSERT INTO rune_pages VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
        r.patch,
        r.region,
        r.rank,
        r.role,
        r.championKey,
        r.slot,
        JSON.stringify(r.runes),
        r.games,
        r.wins,
        r.winRate,
        r.wilsonLower,
      );
    }

    const sql = buildBackfillSql('16.12', 'na1', 'emerald_plus');
    for (const statement of Object.values(sql) as string[]) db.exec(statement);

    const rows = db
      .prepare('SELECT champion_key, role, payload FROM champion_slice ORDER BY champion_key')
      .all() as { champion_key: string; role: string; payload: string }[];
    expect(rows.map((r) => `${r.champion_key}/${r.role}`)).toEqual([
      '145/BOTTOM',
      '412/UTILITY',
      '51/BOTTOM',
    ]);

    const kaisa = JSON.parse(rows[0]!.payload);
    expect(kaisa.matchups[0].opponentKey).toBe('51');
    expect(kaisa.builds[0].opponentKey).toBeNull(); // '-' sentinel decoded
    expect(kaisa.builds[0].items).toEqual([3006, 6672, 3094]);
    expect(kaisa.builds[0].runes.keystone).toBe(8008);
    expect(kaisa.builds[0].bootOptions).toBeNull();
    expect(kaisa.keystones[0].games).toBe(420);
    expect(kaisa.runePages[0].runes.keystone).toBe(8008);
    expect(kaisa.duos[0].supportKey).toBe('412');

    const thresh = JSON.parse(rows[1]!.payload);
    expect(thresh.duos[0].adcKey).toBe('145');
    expect(thresh.matchups).toEqual([]);

    const roleSlice = JSON.parse(
      (db.prepare('SELECT payload FROM role_slice').get() as { payload: string }).payload,
    );
    expect(roleSlice.stats).toHaveLength(2);
    expect(roleSlice.stats[0].pickRate).toBe(0.2);
    expect(roleSlice.stats[0].adjustedWinRate).toBeNull();

    const duoSlice = JSON.parse(
      (db.prepare('SELECT payload FROM duo_slice').get() as { payload: string }).payload,
    );
    expect(duoSlice.duos).toHaveLength(1);
    expect(duoSlice.duos[0].games).toBe(90);
  });
});
