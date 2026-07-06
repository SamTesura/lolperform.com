import {
  BRACKET_TIERS,
  RANK_BRACKETS,
  ROLES,
  wilsonLowerBound,
  type BuildPath,
  type DuoSynergy,
  type Matchup,
  type RankBracket,
  type Region,
  type Role,
  type RoleStats,
  type RunePage,
} from '@lolperform/shared';
import type { NormMatch, NormParticipant } from './riot/types.js';
import { assignTier } from './tier.js';

export interface AggregateResult {
  roleStats: RoleStats[];
  matchups: Matchup[];
  duos: DuoSynergy[];
  builds: BuildPath[];
}

/** Minimum samples before a derived row is emitted (honesty floors). */
export const MIN_MATCHUP_GAMES = 10;
export const MIN_DUO_GAMES = 10;
export const MIN_BUILD_GAMES = 20;

interface Tally {
  games: number;
  wins: number;
}

interface BuildTally extends Tally {
  items: number[];
  runes: RunePage;
}

const tally = (): Tally => ({ games: 0, wins: 0 });
const add = (t: Tally, win: boolean) => {
  t.games += 1;
  if (win) t.wins += 1;
};

function runeSignature(r: RunePage): string {
  return `${r.keystone}-${r.primaryStyle}-${r.subStyle}`;
}

function buildSignature(p: NormParticipant): string {
  const items = [...p.items].sort((a, b) => a - b).join(',');
  return `${items}|${runeSignature(p.runes)}`;
}

/**
 * Aggregate normalized matches into per-slice statistics. Each rank bracket is
 * cumulative (emerald_plus includes diamond+ and master+ matches), computed by
 * filtering on the seed tier each match was sampled from.
 */
export function aggregate(matches: NormMatch[]): AggregateResult {
  const out: AggregateResult = { roleStats: [], matchups: [], duos: [], builds: [] };
  const regions = [...new Set(matches.map((m) => m.region))];
  // "all" pools every region into the largest, steadiest sample. Only emit it
  // when the crawl spans more than one region, so a single-region run doesn't
  // duplicate its rows under both its own key and "all".
  const pool = regions.length > 1;

  for (const bracket of RANK_BRACKETS) {
    const allowed = new Set(BRACKET_TIERS[bracket]);
    if (pool) {
      const pooled = matches.filter((m) => allowed.has(m.tier));
      if (pooled.length > 0) aggregateSlice(pooled, bracket, 'all', out);
    }
    for (const region of regions) {
      const slice = matches.filter((m) => m.region === region && allowed.has(m.tier));
      if (slice.length > 0) aggregateSlice(slice, bracket, region, out);
    }
  }
  return out;
}

function aggregateSlice(
  slice: NormMatch[],
  rank: RankBracket,
  region: Region,
  out: AggregateResult,
): void {
  const patch = slice[0]!.patch;
  const totalMatches = slice.length;

  const roleAgg = new Map<string, Tally>(); // `${role}|${champ}`
  const bans = new Map<string, number>();
  const matchupAgg = new Map<string, Tally>(); // `${champ}|${opp}|${role}`
  const duoAgg = new Map<string, Tally>(); // `${adc}|${sup}`
  const buildAgg = new Map<string, Map<string, BuildTally>>(); // `${champ}|${role}|${opp|-}` -> sig -> tally
  const itemFreq = new Map<string, Map<number, number>>(); // `${champ}|${role}` -> item id -> times bought

  const getTally = (map: Map<string, Tally>, key: string): Tally => {
    let t = map.get(key);
    if (!t) {
      t = tally();
      map.set(key, t);
    }
    return t;
  };

  const addBuild = (champ: string, role: Role, opp: string | null, p: NormParticipant): void => {
    if (p.items.length === 0) return;
    const key = `${champ}|${role}|${opp ?? '-'}`;
    let sigs = buildAgg.get(key);
    if (!sigs) {
      sigs = new Map();
      buildAgg.set(key, sigs);
    }
    const sig = buildSignature(p);
    let bt = sigs.get(sig);
    if (!bt) {
      bt = { games: 0, wins: 0, items: [...p.items].sort((a, b) => a - b), runes: p.runes };
      sigs.set(sig, bt);
    }
    add(bt, p.win);
  };

  for (const m of slice) {
    // Dedupe per match: a champion banned by both teams counts once.
    for (const id of new Set(m.bans)) bans.set(String(id), (bans.get(String(id)) ?? 0) + 1);

    const team: Record<100 | 200, Partial<Record<Role, NormParticipant>>> = { 100: {}, 200: {} };
    for (const p of m.participants) {
      team[p.teamId][p.role] = p;
      add(getTally(roleAgg, `${p.role}|${p.championKey}`), p.win);
      addBuild(p.championKey, p.role, null, p);
      if (p.items.length > 0) {
        const fKey = `${p.championKey}|${p.role}`;
        let f = itemFreq.get(fKey);
        if (!f) {
          f = new Map();
          itemFreq.set(fKey, f);
        }
        for (const id of new Set(p.items)) f.set(id, (f.get(id) ?? 0) + 1);
      }
    }

    for (const role of ROLES) {
      const a = team[100][role];
      const b = team[200][role];
      if (!a || !b) continue;
      add(getTally(matchupAgg, `${a.championKey}|${b.championKey}|${role}`), a.win);
      add(getTally(matchupAgg, `${b.championKey}|${a.championKey}|${role}`), b.win);
      addBuild(a.championKey, role, b.championKey, a);
      addBuild(b.championKey, role, a.championKey, b);
    }

    for (const tid of [100, 200] as const) {
      const adc = team[tid].BOTTOM;
      const sup = team[tid].UTILITY;
      if (adc && sup) add(getTally(duoAgg, `${adc.championKey}|${sup.championKey}`), adc.win);
    }
  }

  // --- emit role stats ---
  for (const [key, t] of roleAgg) {
    const [role, championKey] = key.split('|') as [Role, string];
    const winRate = t.wins / t.games;
    out.roleStats.push({
      patch,
      region,
      rank,
      role,
      championKey,
      games: t.games,
      wins: t.wins,
      winRate,
      pickRate: t.games / totalMatches,
      banRate: (bans.get(championKey) ?? 0) / totalMatches,
      wilsonLower: wilsonLowerBound(t.wins, t.games),
      score: wilsonLowerBound(t.wins, t.games),
      tier: assignTier(winRate, t.games),
      deltaWinRate: null,
      deltaTier: null,
    });
  }

  // --- emit matchups ---
  for (const [key, t] of matchupAgg) {
    if (t.games < MIN_MATCHUP_GAMES) continue;
    const [championKey, opponentKey, role] = key.split('|') as [string, string, Role];
    out.matchups.push({
      patch,
      region,
      rank,
      role,
      championKey,
      opponentKey,
      games: t.games,
      wins: t.wins,
      winRate: t.wins / t.games,
      wilsonLower: wilsonLowerBound(t.wins, t.games),
    });
  }

  // --- emit duos ---
  for (const [key, t] of duoAgg) {
    if (t.games < MIN_DUO_GAMES) continue;
    const [adcKey, supportKey] = key.split('|') as [string, string];
    out.duos.push({
      patch,
      region,
      rank,
      adcKey,
      supportKey,
      games: t.games,
      wins: t.wins,
      winRate: t.wins / t.games,
      wilsonLower: wilsonLowerBound(t.wins, t.games),
    });
  }

  // --- emit vs-opponent builds (most frequent exact signature, floor-gated) ---
  for (const [key, sigs] of buildAgg) {
    const [championKey, role, opp] = key.split('|') as [string, Role, string];
    if (opp === '-') continue; // champion's own build is frequency-based below
    let top: BuildTally | null = null;
    for (const bt of sigs.values()) {
      if (!top || bt.games > top.games) top = bt;
    }
    if (!top || top.games < MIN_BUILD_GAMES) continue;
    out.builds.push({
      patch,
      region,
      rank,
      role,
      championKey,
      opponentKey: opp,
      items: top.items,
      runes: top.runes,
      games: top.games,
      wins: top.wins,
      winRate: top.wins / top.games,
    });
  }

  // --- emit the champion's own "most common build": per-item frequency ---
  // Requiring 20+ games of an *identical* full item set almost never triggers on
  // sampled volume, which left most champions buildless. Instead, rank the items
  // a champion actually buys by how often they appear across all its games and
  // take the top slots (7 for bot-lane roles — the support quest occupies one —
  // 6 everywhere else). Runes come from the most common rune page. The sample
  // behind it is the champion's full game count for the role.
  for (const [key, t] of roleAgg) {
    const [role, championKey] = key.split('|') as [Role, string];
    const freq = itemFreq.get(`${championKey}|${role}`);
    if (!freq || freq.size === 0) continue;
    const slotCount = role === 'BOTTOM' || role === 'UTILITY' ? 7 : 6;
    const items = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, slotCount)
      .map(([id]) => id);
    const sigs = buildAgg.get(`${championKey}|${role}|-`);
    let top: BuildTally | null = null;
    if (sigs) {
      for (const bt of sigs.values()) {
        if (!top || bt.games > top.games) top = bt;
      }
    }
    if (!top) continue;
    out.builds.push({
      patch,
      region,
      rank,
      role,
      championKey,
      opponentKey: null,
      items,
      runes: top.runes,
      games: t.games,
      wins: t.wins,
      winRate: t.wins / t.games,
    });
  }
}
