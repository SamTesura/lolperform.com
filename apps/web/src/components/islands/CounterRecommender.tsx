import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  assignFullTier,
  assignTier,
  DEFAULT_RANK_BRACKET,
  DEFAULT_REGION,
  isRanked,
  REGION_LABELS,
  type ChampionMeta,
  type RankBracket,
  type Region,
  type Role,
  type RoleStats,
} from '@lolperform/shared';
import { fetchMeta, fetchTierList } from '../../lib/api';
import { ChampionPortrait } from '../primitives/ChampionPortrait';
import { TierBadge } from '../primitives/TierBadge';
import { RegionRankControls, RoleTabsInteractive } from './Controls';
import { QueryProvider } from './QueryProvider';
import { EmptyState, Loading } from './States';
import { formatPercent } from '../../lib/format';
import { countersFor, enemiesWithCounters } from '../../data/counters';

function Recommender() {
  const [role, setRole] = useState<Role>('BOTTOM');
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [rank, setRank] = useState<RankBracket>(DEFAULT_RANK_BRACKET);
  const [enemyId, setEnemyId] = useState<string>('');

  const meta = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  // The tier list isn't the source of counters (curated below) — it just enriches
  // each pick with its live role win rate where we have enough games.
  const roleList = useQuery({
    queryKey: ['tierlist', region, rank, role],
    queryFn: () => fetchTierList(region, rank, role),
    retry: false,
  });

  const champs = meta.data?.champions ?? [];
  const idToMeta = new Map<string, ChampionMeta>(champs.map((c) => [c.id, c]));
  const statByKey = new Map<string, RoleStats>(
    (roleList.data?.champions ?? []).map((s) => [s.championKey, s]),
  );
  const version = meta.data?.version;

  const enemyOptions = enemiesWithCounters(role)
    .map((id) => idToMeta.get(id))
    .filter((c): c is ChampionMeta => Boolean(c))
    .sort((a, b) => a.name.localeCompare(b.name));

  const enemy = enemyId ? idToMeta.get(enemyId) : undefined;
  const picks = enemyId ? countersFor(enemyId, role) : [];

  return (
    <div className="space-y-4">
      <RoleTabsInteractive
        value={role}
        onChange={(r) => {
          setRole(r);
          setEnemyId('');
        }}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          <span className="uppercase tracking-[0.08em]">Enemy you're laning against</span>
          <select
            value={enemyId}
            onChange={(e) => setEnemyId(e.target.value)}
            className="select min-h-11 min-w-56 rounded-sm border border-border-default bg-bg-elevated px-2 py-1.5 text-sm text-text-primary"
          >
            <option value="">Select a champion…</option>
            {enemyOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <RegionRankControls region={region} rank={rank} onRegion={setRegion} onRank={setRank} />
      </div>

      {meta.isLoading ? (
        <Loading label="Loading champions…" />
      ) : enemyId === '' ? (
        <EmptyState
          title="Pick the enemy champion"
          detail="Choose who you're up against and we'll show the go-to picks into them, with each pick's current win rate."
        />
      ) : picks.length === 0 ? (
        <EmptyState
          title={`No counters listed for ${enemy?.name ?? 'that champion'} yet`}
          detail="We hand-curate the well-known lane counters — this matchup isn't in the list yet."
        />
      ) : (
        <div>
          <p className="mb-2 text-sm text-text-secondary">
            Go-to picks into <span className="font-semibold text-text-primary">{enemy?.name}</span>:
          </p>
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-default">
            {picks.map((p) => {
              const m = idToMeta.get(p.id);
              if (!m) return null;
              const stat = statByKey.get(m.key);
              const ranked = stat && isRanked(stat.games);
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
                    {ranked ? (
                      <span className="flex items-center gap-2">
                        <TierBadge
                          tier={assignTier(stat!.winRate, stat!.games)}
                          grade={assignFullTier(stat!.winRate, stat!.games)}
                          size="sm"
                        />
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
          <p className="mt-2 text-2xs text-text-muted">
            Curated lane counters. Win rate is each pick's overall {REGION_LABELS[region]} record this
            patch, shown where we have enough games.
          </p>
        </div>
      )}
    </div>
  );
}

export default function CounterRecommender() {
  return (
    <QueryProvider>
      <Recommender />
    </QueryProvider>
  );
}
