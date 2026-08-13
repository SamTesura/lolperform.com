import {
  adjustWinRate,
  playerPoolDelta,
  BRACKET_TIERS,
  RANK_BRACKETS,
  ROLES,
  REGION_POPULATION_SHARE,
  TIER_POPULATION_SHARE,
  wilsonLowerBound,
  type BuildPath,
  type DuoSynergy,
  type KeystoneStats,
  type Matchup,
  type RankBracket,
  type Region,
  type Role,
  type RoleStats,
  type RunePageStats,
  type LeagueTier,
  type RunePage,
  type SkillFloor,
} from '@lolperform/shared';
import type { NormMatch, NormParticipant } from './riot/types.js';
import { gradeSlice } from './tier.js';

export interface AggregateResult {
  roleStats: RoleStats[];
  keystones: KeystoneStats[];
  runePages: RunePageStats[];
  matchups: Matchup[];
  duos: DuoSynergy[];
  builds: BuildPath[];
}

/** Minimum samples before a derived row is emitted (honesty floors). */
export const MIN_MATCHUP_GAMES = 10;
export const MIN_DUO_GAMES = 10;
export const MIN_BUILD_GAMES = 20;
/** A keystone needs this many games on a champion before it is worth showing.
 *  Keystone choice is coarse — most champions realistically run three to six —
 *  so the arms stay fat and this floor is about noise, not scarcity. */
export const MIN_KEYSTONE_GAMES = 100;

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
  completedItems?: ReadonlySet<number>,
  bootItems?: ReadonlySet<number>,
): AggregateResult {
  const out: AggregateResult = {
    roleStats: [],
    keystones: [],
    runePages: [],
    matchups: [],
    duos: [],
    builds: [],
  };
  const regions = [...new Set(matches.map((m) => m.region))];
  // "all" pools every region into the largest, steadiest sample. Only emit it
  // when the crawl spans more than one region, so a single-region run doesn't
  // duplicate its rows under both its own key and "all".
  const pool = regions.length > 1;

  for (const bracket of RANK_BRACKETS) {
    const allowed = new Set(BRACKET_TIERS[bracket]);
    if (pool) {
      const pooled = matches.filter((m) => allowed.has(m.tier));
      if (pooled.length > 0) aggregateSlice(pooled, bracket, 'all', out, skillFloors, completedItems, bootItems);
    }
    for (const region of regions) {
      const slice = matches.filter((m) => m.region === region && allowed.has(m.tier));
      if (slice.length > 0) aggregateSlice(slice, bracket, region, out, skillFloors, completedItems, bootItems);
    }
  }
  return out;
}

/**
 * Career win rates of the seed players observed in this slice, centred within
 * their own rank tier and grouped by the champion they were playing.
 *
 * Centring per tier matters: a Challenger player's career win rate is higher
 * than an Emerald player's because they climbed, so a champion that skews
 * apex would otherwise look like it had a strong player pool purely from the
 * rank mix. Within-tier deviations carry only the part we want — how strong
 * this champion's players are *for their rank*.
 */
function centredBaselines(slice: NormMatch[]): Map<string, number[]> {
  const byTier = new Map<LeagueTier, { sum: number; n: number }>();
  for (const m of slice) {
    if (!m.seed) continue;
    const t = byTier.get(m.tier) ?? { sum: 0, n: 0 };
    t.sum += m.seed.baselineWinRate;
    t.n += 1;
    byTier.set(m.tier, t);
  }
  const out = new Map<string, number[]>();
  for (const m of slice) {
    if (!m.seed) continue;
    const t = byTier.get(m.tier)!;
    const key = `${m.seed.role}|${m.seed.championKey}`;
    const list = out.get(key) ?? [];
    list.push(m.seed.baselineWinRate - t.sum / t.n);
    out.set(key, list);
  }
  return out;
}

function aggregateSlice(
  slice: NormMatch[],
  rank: RankBracket,
  region: Region,
  out: AggregateResult,
  skillFloors?: ReadonlyMap<string, SkillFloor>,
  completedItems?: ReadonlySet<number>,
  bootItems?: ReadonlySet<number>,
): void {
  const patch = slice[0]!.patch;
  // Without a catalog every item counts (old behaviour, and what tests use).
  const isCompleted = (id: number): boolean => completedItems?.has(id) ?? true;
  const isBoots = (id: number): boolean => bootItems?.has(id) ?? false;
  const totalMatches = slice.length;
  const weights = matchWeights(slice, region === 'all');
  const baselines = centredBaselines(slice);

  const roleAgg = new Map<string, Tally>(); // `${role}|${champ}`
  const bans = new Map<string, number>();
  const matchupAgg = new Map<string, Tally>(); // `${champ}|${opp}|${role}`
  const duoAgg = new Map<string, Tally>(); // `${adc}|${sup}`
  const buildAgg = new Map<string, Map<string, BuildTally>>(); // `${champ}|${role}|${opp|-}` -> sig -> tally
  const itemFreq = new Map<string, Map<number, number>>(); // `${champ}|${role}` -> item id -> times bought
  const slotAgg = new Map<string, Map<number, number>[]>(); // `${champ}|${role}` -> slot index -> item -> count
  const bootAgg = new Map<string, Map<number, number>>(); // `${champ}|${role}` -> boots item -> count
  const spellAgg = new Map<string, Map<string, Tally>>(); // `${champ}|${role}` -> `${a}-${b}` -> tally
  // `${role}|${champ}` -> runeSignature -> tally + mode count of full pages
  const runePageAgg = new Map<
    string,
    Map<string, { tally: Tally; pages: Map<string, { page: RunePage; n: number }> }>
  >();
  const keystoneAgg = new Map<string, Tally>(); // `${role}|${champ}|${keystone}`

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
      if (p.runes.keystone > 0) {
        add(getTally(keystoneAgg, `${p.role}|${p.championKey}|${p.runes.keystone}`), p.win, w);
        const rpKey = `${p.role}|${p.championKey}`;
        let sigs2 = runePageAgg.get(rpKey);
        if (!sigs2) {
          sigs2 = new Map();
          runePageAgg.set(rpKey, sigs2);
        }
        const sig = runeSignature(p.runes);
        let entry = sigs2.get(sig);
        if (!entry) {
          entry = { tally: tally(), pages: new Map() };
          sigs2.set(sig, entry);
        }
        add(entry.tally, p.win, w);
        const pageKey = JSON.stringify(p.runes);
        const pc = entry.pages.get(pageKey);
        if (pc) pc.n += 1;
        else entry.pages.set(pageKey, { page: p.runes, n: 1 });
      }
      addBuild(p.championKey, p.role, null, p);
      if (p.items.length > 0) {
        const fKey = `${p.championKey}|${p.role}`;
        let f = itemFreq.get(fKey);
        if (!f) {
          f = new Map();
          itemFreq.set(fKey, f);
        }
        const finished = p.items.filter(isCompleted);
        for (const id of new Set(finished)) f.set(id, (f.get(id) ?? 0) + 1);
        // Boots are their own decision, tallied separately so the positional
        // slots describe the actual damage/utility build order.
        let sk = slotAgg.get(fKey);
        if (!sk) {
          sk = [];
          slotAgg.set(fKey, sk);
        }
        let bt2 = bootAgg.get(fKey);
        if (!bt2) {
          bt2 = new Map();
          bootAgg.set(fKey, bt2);
        }
        // Inventory position as an (approximate) build-order proxy: slot k of
        // the non-boot finished list is roughly the k-th completed item.
        finished
          .filter((id) => !isBoots(id))
          .forEach((id, si) => {
            const bucket = (sk![si] ??= new Map());
            bucket.set(id, (bucket.get(id) ?? 0) + 1);
          });
        for (const id of finished.filter(isBoots)) bt2.set(id, (bt2.get(id) ?? 0) + 1);
        // 2026 role quests park boots in a slotless quest slot (ADC): the id
        // arrives via roleBoundItem, never in item0-5.
        if (p.quest && isBoots(p.quest)) bt2.set(p.quest, (bt2.get(p.quest) ?? 0) + 1);
      }
      if (p.spells) {
        let sp = spellAgg.get(`${p.championKey}|${p.role}`);
        if (!sp) {
          sp = new Map();
          spellAgg.set(`${p.championKey}|${p.role}`, sp);
        }
        add(getTally(sp, `${p.spells[0]}-${p.spells[1]}`), p.win, w);
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
    // Deviations are already centred within tier, so the reference point is 0.
    const pool = playerPoolDelta({ baselines: baselines.get(key) ?? [], poolMean: 0 });
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
      adjustedWinRate: pool.observations > 0 ? adjustWinRate(winRate, pool.delta) : null,
      playerPoolDelta: pool.observations > 0 ? pool.delta : null,
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
      slotOptions: null,
      bootOptions: null,
      spellOptions: null,
    });
  }

  // --- emit keystone win rates ---
  // Weighted like role stats, so the rank/region correction carries over. The
  // floor is a noise guard, not a scarcity one: a champion realistically runs
  // three to six keystones, so the arms are fat wherever the champion itself
  // has a usable sample.
  for (const [key, t] of keystoneAgg) {
    if (t.games < MIN_KEYSTONE_GAMES) continue;
    const [role, championKey, keystone] = key.split('|') as [Role, string, string];
    out.keystones.push({
      patch,
      region,
      rank,
      role,
      championKey,
      keystone: Number(keystone),
      games: t.games,
      wins: t.wins,
      winRate: t.wWins / t.wGames,
      wilsonLower: wilsonLowerBound(t.wWins, t.wGames),
    });
  }

  // --- emit the champion's two most common rune pages ---
  // Signature = keystone + both styles (fat arms); the stored page is the most
  // common full page inside the signature, and games/wins are the signature's
  // own — a pre-lock sample, so the win rate is honest to show.
  for (const [key, sigs2] of runePageAgg) {
    const [role, championKey] = key.split('|') as [Role, string];
    const ranked2 = [...sigs2.values()]
      .filter((e) => e.tally.games >= MIN_KEYSTONE_GAMES)
      .sort((a, b) => b.tally.games - a.tally.games)
      .slice(0, 2);
    ranked2.forEach((e, i) => {
      let best: { page: RunePage; n: number } | null = null;
      for (const pc of e.pages.values()) if (!best || pc.n > best.n) best = pc;
      if (!best) return;
      out.runePages.push({
        patch,
        region,
        rank,
        role,
        championKey,
        slot: (i + 1) as 1 | 2,
        runes: best.page,
        games: e.tally.games,
        wins: e.tally.wins,
        winRate: e.tally.wWins / e.tally.wGames,
        wilsonLower: wilsonLowerBound(e.tally.wWins, e.tally.wGames),
      });
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

    // Per-slot alternatives: top finished items at each inventory position,
    // with each option's share of the games that filled that slot. Boots are
    // their own row. Popularity, deliberately not per-slot win rates.
    const topOptions = (bucket: Map<number, number> | undefined, take: number) => {
      if (!bucket || bucket.size === 0) return [];
      const filled = [...bucket.values()].reduce((a, b) => a + b, 0);
      return [...bucket.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, take)
        .map(([item, n]) => ({ item, share: n / filled, games: n }));
    };
    const slots = slotAgg.get(`${championKey}|${role}`) ?? [];
    // 6 deep, not 3: the UI dedupes items across columns (core trio first),
    // so it needs spares below the raw top of each slot.
    const slotOptions = slots.slice(0, slotCount).map((bucket) => topOptions(bucket, 6));
    const bootOptions = topOptions(bootAgg.get(`${championKey}|${role}`), 3);
    // Spell pairs carry their own win rate — locked in champion select, so
    // unlike items the number cannot be an effect of already winning.
    const spellTallies = spellAgg.get(`${championKey}|${role}`);
    let spellOptions: NonNullable<BuildPath['spellOptions']> = [];
    if (spellTallies) {
      const filled = [...spellTallies.values()].reduce((a2, b2) => a2 + b2.games, 0);
      spellOptions = [...spellTallies.entries()]
        .sort((a2, b2) => b2[1].games - a2[1].games)
        .slice(0, 3)
        .map(([pair, st]) => ({
          spells: pair.split('-').map(Number) as [number, number],
          share: st.games / filled,
          games: st.games,
          wins: st.wins,
          winRate: st.wWins / st.wGames,
        }));
    }

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
      slotOptions: slotOptions.some((o) => o.length > 0) ? slotOptions : null,
      bootOptions: bootOptions.length > 0 ? bootOptions : null,
      spellOptions: spellOptions.length > 0 ? spellOptions : null,
    });
  }
}
