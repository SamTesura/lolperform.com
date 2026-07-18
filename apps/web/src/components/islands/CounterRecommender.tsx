import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  baseTier,
  DEFAULT_RANK_BRACKET,
  DEFAULT_REGION,
  isRanked,
  REGION_LABELS,
  type RankBracket,
  type Region,
  type Role,
  type RoleStats,
} from '@lolperform/shared';
import { fetchCounters, fetchTierList } from '../../lib/api';
import { ChampionPortrait } from '../primitives/ChampionPortrait';
import { TierBadge } from '../primitives/TierBadge';
import { RegionRankControls, RoleTabsInteractive } from './Controls';
import { QueryProvider } from './QueryProvider';
import { EmptyState, Loading } from './States';
import { formatPercent } from '../../lib/format';
import { countersFor, enemiesWithCounters } from '../../data/counters';

/** Head-to-head rows below this many shared games are too noisy to recommend. */
const MIN_H2H_GAMES = 25;

/** Build-time champion roster (from Data Dragon) — the dropdown never depends
 *  on the live API being reachable. */
export interface RosterChampion {
  key: string;
  id: string;
  name: string;
}

interface Props {
  champions: RosterChampion[];
  version?: string;
}

function Recommender({ champions, version }: Props) {
  const [role, setRole] = useState<Role>('BOTTOM');
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [rank, setRank] = useState<RankBracket>(DEFAULT_RANK_BRACKET);
  const [enemyKey, setEnemyKey] = useState<string>('');

  const roleList = useQuery({
    queryKey: ['tierlist', region, rank, role],
    queryFn: () => fetchTierList(region, rank, role),
    retry: false,
  });
  // Live head-to-head records vs the selected enemy — fills every matchup the
  // hand-curated list doesn't cover, from this patch's own games.
  const counters = useQuery({
    queryKey: ['counters', region, rank, role, enemyKey],
    queryFn: () => fetchCounters(region, rank, role, enemyKey),
    enabled: enemyKey !== '',
    retry: false,
  });

  const keyToMeta = new Map<string, RosterChampion>(champions.map((c) => [c.key, c]));
  const idToMeta = new Map<string, RosterChampion>(champions.map((c) => [c.id, c]));
  const statByKey = new Map<string, RoleStats>(
    (roleList.data?.champions ?? []).map((s) => [s.championKey, s]),
  );

  // The lane's real roster: champions the tier list itself ranks here (score
  // > 0 — past the games floor, or provisional off a blended prior patch),
  // plus any enemy the curated list covers. Deliberately NOT everyone who
  // ever flexed into the lane — a 60-game Singed bot is not an enemy worth a
  // dropdown slot.
  const enemyKeys = new Set<string>(
    (roleList.data?.champions ?? [])
      .filter((s) => s.score > 0)
      .map((s) => s.championKey),
  );
  for (const id of enemiesWithCounters(role)) {
    const m = idToMeta.get(id);
    if (m) enemyKeys.add(m.key);
  }
  const enemyOptions = [...enemyKeys]
    .map((k) => keyToMeta.get(k))
    .filter((c): c is RosterChampion => Boolean(c))
    .sort((a, b) => a.name.localeCompare(b.name));

  const enemy = enemyKey ? keyToMeta.get(enemyKey) : undefined;
  const curated = enemy ? countersFor(enemy.id, role) : [];
  const dataPicks = (counters.data?.counters ?? [])
    .filter((c) => c.games >= MIN_H2H_GAMES && c.championKey !== enemyKey && keyToMeta.has(c.championKey))
    .slice(0, 8);

  return (
    <div className="space-y-4">
      <RoleTabsInteractive
        value={role}
        onChange={(r) => {
          setRole(r);
          setEnemyKey('');
        }}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          <span className="uppercase tracking-[0.08em]">Enemy you're laning against</span>
          <select
            value={enemyKey}
            onChange={(e) => setEnemyKey(e.target.value)}
            className="select min-h-11 min-w-56 rounded-sm border border-border-default bg-bg-elevated px-2 py-1.5 text-sm text-text-primary"
          >
            <option value="">Select a champion…</option>
            {enemyOptions.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <RegionRankControls region={region} rank={rank} onRegion={setRegion} onRank={setRank} />
      </div>

      {enemyKey === '' ? (
        <EmptyState
          title="Pick the enemy champion"
          detail="Choose who you're up against — you'll get the known counters plus this patch's best head-to-head records."
        />
      ) : (
        <div className="space-y-5">
          {curated.length > 0 ? (
            <div>
              <p className="mb-2 text-sm text-text-secondary">
                Go-to picks into <span className="font-semibold text-text-primary">{enemy?.name}</span>:
              </p>
              <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-default">
                {curated.map((p) => {
                  const m = idToMeta.get(p.id);
                  if (!m) return null;
                  const stat = statByKey.get(m.key);
                  // Same contract as everywhere else: a tier badge only for
                  // graded rows (score > 0 — past the floor, or provisional);
                  // a bare win rate above 50 games; a dash below that.
                  const hasStats = stat && isRanked(stat.games);
                  const tiered = stat && stat.score > 0;
                  return (
                    <li key={p.id}>
                      <a
                        href={`/champion/${m.id}`}
                        className="grid grid-cols-[40px_1fr_auto] items-center gap-3 bg-bg-surface px-3 py-2 transition-colors duration-150 hover:bg-bg-elevated"
                      >
                        <ChampionPortrait championId={m.id} name={m.name} version={version} size={40} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-text-primary">{m.name}</span>
                          {p.note ? (
                            <span className="block truncate text-2xs text-text-muted">{p.note}</span>
                          ) : null}
                        </span>
                        {hasStats ? (
                          <span className="flex items-center gap-2">
                            {tiered ? (
                              <TierBadge
                                tier={baseTier(stat!.tier)}
                                grade={stat!.tier}
                                size="sm"
                                provisional={stat!.provisional}
                              />
                            ) : null}
                            <span
                              className={`stat text-sm font-semibold ${stat!.winRate >= 0.5 ? 'text-positive' : 'text-negative'}`}
                            >
                              {formatPercent(stat!.winRate)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-2xs text-text-muted" title="Not enough games this patch">
                            —
                          </span>
                        )}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {counters.isLoading ? (
            <Loading label="Checking this patch's head-to-heads…" />
          ) : dataPicks.length > 0 ? (
            <div>
              <p className="mb-2 text-sm text-text-secondary">
                Best head-to-head records into{' '}
                <span className="font-semibold text-text-primary">{enemy?.name}</span> this patch:
              </p>
              <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-default">
                {dataPicks.map((c) => {
                  const m = keyToMeta.get(c.championKey)!;
                  return (
                    <li key={c.championKey}>
                      <a
                        href={`/matchup?self=${m.id}&opp=${enemy?.id ?? ''}&role=${role}`}
                        className="grid grid-cols-[40px_1fr_auto] items-center gap-3 bg-bg-surface px-3 py-2 transition-colors duration-150 hover:bg-bg-elevated"
                      >
                        <ChampionPortrait championId={m.id} name={m.name} version={version} size={40} />
                        <span className="truncate text-sm font-medium text-text-primary">{m.name}</span>
                        <span className="flex items-center gap-3">
                          <span className="text-2xs text-text-muted">
                            {c.games.toLocaleString('en-US')} games
                          </span>
                          <span
                            className={`stat text-sm font-semibold ${c.winRate >= 0.5 ? 'text-positive' : 'text-negative'}`}
                          >
                            {formatPercent(c.winRate)}
                          </span>
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-2xs text-text-muted">
                Win rate in this exact lane matchup ({REGION_LABELS[region]}, this patch, minimum{' '}
                {MIN_H2H_GAMES} shared games). The sample grows every few hours.
              </p>
            </div>
          ) : curated.length === 0 ? (
            <EmptyState
              title={`Not enough data on ${enemy?.name ?? 'that champion'} yet`}
              detail={`No curated counters for this matchup, and no lane head-to-head has reached ${MIN_H2H_GAMES} games this patch. The crawler runs every few hours — this fills in on its own.`}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function CounterRecommender(props: Props) {
  return (
    <QueryProvider>
      <Recommender {...props} />
    </QueryProvider>
  );
}
