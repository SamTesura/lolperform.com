import {
  BRACKET_TIERS,
  RANK_BRACKETS,
  ROLES,
  REGION_POPULATION_SHARE,
  TIER_POPULATION_SHARE,
  wilsonLowerBound,
  type BuildPath,
  type DuoSynergy,
  type Matchup,
  type RankBracket,
  type Region,
  type Role,
  type RoleStats,
  type RunePage,
  type SkillFloor,
} from '@lolperform/shared';
import type { NormMatch, NormParticipant } from './riot/types.js';
import { gradeSlice } from './tier.js';

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
  /** Population-weighted counterparts (post-stratification); equal to the raw
   *  counts wherever weighting isn't applied (matchups, duos, builds). */
  wGames: number;
  wWins: number;
}

interface BuildTally extends Tally {
  items: number[];
  runes: RunePage;
}

const tally = (): Tally => ({ games: 0, wins: 0, wGames: 0, wWins: 0 });
const add = (t: Tally, win: boolean, weight = 1) => {
  t.games += 1;
  if (win) t.wins += 1;
  t.wGames += weight;
  if (win) t.wWins += weight;
};

/**
 * Post-stratification weight per (seed tier × region) cell: reweights the
 * slice to the bracket's real rank distribution (TIER_POPULATION_SHARE) and —
 * for the pooled "all" view — to real server populations
 * (REGION_POPULATION_SHARE), so neither the crawl's deliberately apex-heavy
 * mix (kept for master_plus volume) nor its equal-per-region budget skews the
 * stats of elo- or region-sensitive champions. Normalized so weights sum to
 * the raw match count over the cells actually present — rates keep their
 * scale.
 */
function matchWeights(slice: NormMatch[], pooled: boolean): Map<string, number> {
  const counts = new Map<string, number>();
  const targets = new Map<string, number>();
  for (const m of slice) {
    const key = `${m.tier}|${m.region}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!targets.has(key)) {
      targets.set(
        key,
        TIER_POPULATION_SHARE[m.tier] *
          (pooled ? ((REGION_POPULATION_SHARE as Record<string, number>)[m.region] ?? 1) : 1),
      );
    }
  }
  let presentShare = 0;
  for (const t of targets.values()) presentShare += t;
  const weights = new Map<string, number>();
  for (const [key, n] of counts) {
    // Trimmed to [1/4, 4]: an under-crawled cell with a big population target
    // (say KR Emerald) would otherwise get a 40x weight and let a handful of
    // lucky games swing a champion by several points — variance the correction
    // isn't worth. Trimming keeps most of the bias correction, and as the
    // crawl's own mix converges on the targets the weights approach 1 and the
    // clamp stops binding.
    const raw = (targets.get(key)! / presentShare) * (slice.length / n);
    weights.set(key, Math.min(4, Math.max(0.25, raw)));
  }
  return weights;
}

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
export function aggregate(
  matches: NormMatch[],
  skillFloors?: ReadonlyMap<string, SkillFloor>,
): AggregateResult {
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
      if (pooled.length > 0) aggregateSlice(pooled, bracket, 'all', out, skillFloors);
    }
    for (const region of regions) {
      const slice = matches.filter((m) => m.region === region && allowed.has(m.tier));
      if (slice.length > 0) aggregateSlice(slice, bracket, region, out, skillFloors);
    }
  }
  return out;
}

function aggregateSlice(
  slice: NormMatch[],
  rank: RankBracket,
  region: Region,
  out: AggregateResult,
  skillFloors?: ReadonlyMap<string, SkillFloor>,
): void {
  const patch = slice[0]!.patch;
  const totalMatches = slice.length;
  const weights = matchWeights(slice, region === 'all');

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
      bt = { ...tally(), items: [...p.items].sort((a, b) => a - b), runes: p.runes };
      sigs.set(sig, bt);
    }
    add(bt, p.win);
  };

  for (const m of slice) {
    const w = weights.get(`${m.tier}|${m.region}`) ?? 1;
    // Dedupe per match: a champion banned by both teams counts once.
    for (const id of new Set(m.bans)) bans.set(String(id), (bans.get(String(id)) ?? 0) + w);

    const team: Record<100 | 200, Partial<Record<Role, NormParticipant>>> = { 100: {}, 200: {} };
    for (const p of m.participants) {
      team[p.teamId][p.role] = p;
      add(getTally(roleAgg, `${p.role}|${p.championKey}`), p.win, w);
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

  // --- emit role stats (graded per role pool by combined ranking) ---
  // Rates come from the population-weighted tallies; `games`/`wins` stay raw
  // so displayed sample sizes and honesty floors reflect matches actually
  // analyzed. `winRate` is therefore the estimator, not wins/games.
  const sliceRows: RoleStats[] = [];
  for (const [key, t] of roleAgg) {
    const [role, championKey] = key.split('|') as [Role, string];
    const winRate = t.wWins / t.wGames;
    sliceRows.push({
      patch,
      region,
      rank,
      role,
      championKey,
      games: t.games,
      wins: t.wins,
      winRate,
      pickRate: t.wGames / totalMatches,
      banRate: (bans.get(championKey) ?? 0) / totalMatches,
      wilsonLower: wilsonLowerBound(t.wWins, t.wGames),
      score: 0, // set by gradeSlice below
      tier: 'D-', // placeholder; set by gradeSlice below
      provisional: false, // set by gradeSlice below
      deltaWinRate: null,
      deltaTier: null,
    });
  }
  // Grades are relative to the role's pool in this slice, so grading must see
  // the whole role at once — a per-champion function can't rank. The pipeline
  // grades one patch in isolation (no priorPatch input), so provisional is
  // always false here; the worker recomputes live with prior-patch blending.
  for (const role of ROLES) {
    const rows = sliceRows.filter((r) => r.role === role);
    const graded = gradeSlice(
      rows.map((r) => ({ ...r, skillFloor: skillFloors?.get(r.championKey) })),
    );
    rows.forEach((r, i) => {
      r.tier = graded[i]!.grade;
      r.score = graded[i]!.score;
      r.provisional = graded[i]!.provisional;
    });
  }
  out.roleStats.push(...sliceRows);

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
