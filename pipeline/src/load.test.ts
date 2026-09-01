import { describe, expect, it } from 'vitest';
import {
  buildLoadSql,
  estimateRowWrites,
  trimPayload,
  type LoadInput,
} from './load.js';

const input: LoadInput = {
  meta: {
    patch: '16.12',
    version: '16.12.1',
    generatedAt: '2026-06-17T00:00:00.000Z',
    totalMatches: 1000,
  },
  champions: [
    { key: '145', id: 'Kaisa', name: "Kai'Sa", title: 'Daughter of the Void', roles: [] },
  ],
  roleStats: [
    {
      patch: '16.12',
      region: 'na1',
      rank: 'emerald_plus',
      role: 'BOTTOM',
      championKey: '145',
      games: 800,
      wins: 420,
      winRate: 0.525,
      pickRate: 0.2,
      banRate: 0.05,
      adjustedWinRate: null,
      playerPoolDelta: null,
      wilsonLower: 0.49,
      score: 0.49,
      tier: 'S',
      provisional: false,
      deltaWinRate: null,
      deltaTier: null,
    },
  ],
  matchups: [
    {
      patch: '16.12',
      region: 'na1',
      rank: 'emerald_plus',
      role: 'BOTTOM',
      championKey: '145',
      opponentKey: '51',
      games: 120,
      wins: 70,
      winRate: 0.583,
      wilsonLower: 0.5,
    },
  ],
  duos: [
    {
      patch: '16.12',
      region: 'na1',
      rank: 'emerald_plus',
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
      patch: '16.12',
      region: 'na1',
      rank: 'emerald_plus',
      role: 'BOTTOM',
      championKey: '145',
      opponentKey: null,
      items: [3006, 6672, 3094],
      runes: {
        keystone: 8008,
        primaryStyle: 8000,
        subStyle: 8200,
        primary: [8008],
        secondary: [8226],
        shards: [5005, 5008, 5001],
      },
      games: 300,
      wins: 165,
      winRate: 0.55,
      slotOptions: [[{ item: 6672, share: 0.62, games: 186 }]],
      bootOptions: [{ item: 3006, share: 0.8, games: 240 }],
      spellOptions: [{ spells: [4, 7], share: 0.9, games: 270, wins: 149, winRate: 0.5519 }],
      coreOptions: [
        { items: [3006, 6672, 3094], share: 0.7, games: 210, wins: 118, winRate: 0.5619 },
      ],
      startOptions: [
        { items: [1055, 2003], share: 0.8, games: 48, wins: 27, winRate: 0.5625 },
      ],
    },
  ],
  keystones: [
    {
      patch: '16.12',
      region: 'na1',
      rank: 'emerald_plus',
      role: 'BOTTOM',
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
      patch: '16.12',
      region: 'na1',
      rank: 'emerald_plus',
      role: 'BOTTOM',
      championKey: '145',
      slot: 1,
      runes: {
        keystone: 8008,
        primaryStyle: 8000,
        subStyle: 8200,
        primary: [8008],
        secondary: [8226],
        shards: [5005, 5008, 5001],
      },
      games: 380,
      wins: 209,
      winRate: 0.55,
      wilsonLower: 0.5,
    },
  ],
};

/** Parse the payload literal for one champion_slice row out of the emitted SQL. */
function payloadFor(sql: string, championKey: string, role: string): Record<string, unknown> {
  const rowStart = sql.indexOf(`'${championKey}', '${role}', '{`);
  expect(rowStart).toBeGreaterThan(-1);
  const open = sql.indexOf("'{", rowStart);
  const close = sql.indexOf("}'", open);
  const json = sql.slice(open + 1, close + 1).replace(/''/g, "'");
  return JSON.parse(json) as Record<string, unknown>;
}

describe('buildLoadSql', () => {
  const sql = buildLoadSql(input);

  it('upserts the slice tables instead of clearing the patch first', () => {
    for (const t of ['patches', 'champions', 'champion_slice', 'role_slice', 'duo_slice']) {
      expect(sql).toContain(`INSERT OR REPLACE INTO ${t}`);
    }
    // A DELETE costs a row write exactly like an INSERT on the free plan, so
    // wiping the patch before rewriting it doubled the bill. Rows are upserted
    // by primary key instead.
    expect(sql).not.toContain("DELETE FROM champion_slice WHERE patch = '16.12';");
    expect(sql).not.toContain('DELETE FROM matchups');
    expect(sql).not.toContain('DELETE FROM champions;');
  });

  it('prunes only rows an earlier run left behind', () => {
    for (const t of ['champion_slice', 'role_slice', 'duo_slice']) {
      expect(sql).toContain(
        `DELETE FROM ${t} WHERE patch = '16.12' AND loaded_at <> '2026-06-17T00:00:00.000Z';`,
      );
    }
  });

  it('keeps a bounded patch retention window', () => {
    expect(sql).toContain('DELETE FROM champion_slice WHERE patch NOT IN');
    expect(sql).toContain('ORDER BY generated_at DESC LIMIT 3');
    // patches rows go last so the survivor subquery still names them
    expect(sql.lastIndexOf('DELETE FROM patches')).toBeGreaterThan(
      sql.lastIndexOf('DELETE FROM champion_slice'),
    );
  });

  it('escapes single quotes in champion names', () => {
    expect(sql).toContain("'Kai''Sa'");
    expect(sql).not.toContain("'Kai'Sa'");
  });

  it('folds a champion’s matchups, builds, keystones and rune pages into one row', () => {
    const payload = payloadFor(sql, '145', 'BOTTOM');
    expect(payload.matchups).toHaveLength(1);
    expect(payload.builds).toHaveLength(1);
    expect(payload.keystones).toHaveLength(1);
    expect(payload.runePages).toHaveLength(1);
    // keystone rows keep their OWN sample, not the champion's totals
    expect((payload.keystones as { games: number }[])[0]!.games).toBe(420);
    expect(JSON.stringify(payload.builds)).toContain('3006');
  });

  it('files a duo under both the ADC and the support', () => {
    expect((payloadFor(sql, '145', 'BOTTOM').duos as unknown[]).length).toBe(1);
    expect((payloadFor(sql, '412', 'UTILITY').duos as unknown[]).length).toBe(1);
  });

  it('stores role stats ungraded, one row per role slice', () => {
    const start = sql.indexOf('INSERT OR REPLACE INTO role_slice');
    const chunk = sql.slice(start, sql.indexOf(';', start));
    expect(chunk).toContain("'na1', 'emerald_plus', 'BOTTOM'");
    expect(chunk).toContain('"championKey":"145"');
    expect(chunk).toContain('"pickRate":0.2');
  });

  it('never emits a NaN literal', () => {
    expect(sql).not.toContain('NaN');
  });

  it('keeps every statement under the D1 100 KB cap even with fat JSON rows', () => {
    // Run 31641932893 died on SQLITE_TOOBIG: 100 rows per statement crossed
    // D1's 100 KB statement limit once slot/boot/spell JSON landed. Payload
    // rows are far fatter, so the byte cap has to hold on its own.
    const fatOptions = Array.from({ length: 3 }, () =>
      Array.from({ length: 40 }, (_, i) => ({ item: 3000 + i, share: 0.0123, games: 1234 })),
    );
    const fat: LoadInput = {
      ...input,
      builds: Array.from({ length: 200 }, (_, i) => ({
        ...input.builds[0]!,
        championKey: String(i),
        slotOptions: fatOptions,
      })),
    };
    const statements = buildLoadSql(fat)
      .split(/;\n/)
      .filter((t) => t.trim().length > 0);
    expect(statements.length).toBeGreaterThan(2); // byte cap actually split them
    for (const st of statements) {
      expect(Buffer.byteLength(st, 'utf8')).toBeLessThan(100_000);
    }
    // nothing lost to the chunking: every champion still has its row
    const joined = statements.join(';');
    for (let i = 0; i < 200; i++) {
      expect(joined).toContain(`'${i}', 'BOTTOM'`);
    }
  });

  it('trims a payload that would blow the statement cap, thinnest sample first', () => {
    const matchups = Array.from({ length: 400 }, (_, i) => ({
      opponentKey: String(i),
      games: i + 1,
      wins: i,
      winRate: 0.5,
      wilsonLower: 0.4,
    }));
    const trimmed = trimPayload(
      { matchups, builds: [], keystones: [], runePages: [], duos: [] },
      2_000,
    );
    expect(Buffer.byteLength(JSON.stringify(trimmed), 'utf8')).toBeLessThanOrEqual(2_000);
    expect(trimmed.matchups.length).toBeLessThan(matchups.length);
    // what survives is the fattest sample, not an arbitrary slice
    expect(trimmed.matchups[0]!.games).toBe(400);
  });
});

describe('estimateRowWrites', () => {
  it('counts one row per slice, not one per aggregated record', () => {
    // 1 patch + 1 champion + 2 champion_slice rows (145 BOTTOM, 412 UTILITY)
    // + 1 role_slice + 1 duo_slice
    expect(estimateRowWrites(input)).toBe(6);
  });

  it('scales with champions and slices, not with matchup fan-out', () => {
    const wide: LoadInput = {
      ...input,
      matchups: Array.from({ length: 5_000 }, (_, i) => ({
        ...input.matchups[0]!,
        opponentKey: String(i),
      })),
    };
    // 5,000 extra matchups all land in the one champion row they belong to
    expect(estimateRowWrites(wide)).toBe(estimateRowWrites(input));
  });
});
