import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  assignFullTier,
  DEFAULT_RANK_BRACKET,
  DEFAULT_REGION,
  type RankBracket,
  type Region,
  type Role,
} from '@lolperform/shared';
import { fetchCounters, fetchMeta } from '../../lib/api';
import { championIndex } from '../../lib/champions';
import { ChampionPortrait } from '../primitives/ChampionPortrait';
import { ConfidenceChip } from '../primitives/ConfidenceChip';
import { TierBadge } from '../primitives/TierBadge';
import { RegionRankControls, RoleTabsInteractive } from './Controls';
import { QueryProvider } from './QueryProvider';
import { EmptyState, Loading } from './States';
import { formatPercent } from '../../lib/format';

function Recommender() {
  const [role, setRole] = useState<Role>('BOTTOM');
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [rank, setRank] = useState<RankBracket>(DEFAULT_RANK_BRACKET);
  const [opponentKey, setOpponentKey] = useState<string>('');

  const meta = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const counters = useQuery({
    queryKey: ['counters', region, rank, role, opponentKey],
    queryFn: () => fetchCounters(region, rank, role, opponentKey),
    enabled: opponentKey !== '',
    retry: false,
  });

  const index = meta.data ? championIndex(meta.data.champions) : new Map();
  const version = meta.data?.version;
  const champoptions = meta.data?.champions ?? [];
  const enemy = opponentKey ? index.get(opponentKey) : undefined;

  return (
    <div className="space-y-4">
      <RoleTabsInteractive value={role} onChange={setRole} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          <span className="uppercase tracking-[0.08em]">Enemy you're laning against</span>
          <select
            value={opponentKey}
            onChange={(e) => setOpponentKey(e.target.value)}
            className="min-w-56 rounded-sm border border-border-default bg-bg-elevated px-2 py-1.5 text-sm text-text-primary"
          >
            <option value="">Select a champion…</option>
            {champoptions.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <RegionRankControls region={region} rank={rank} onRegion={setRegion} onRank={setRank} />
      </div>

      {opponentKey === '' ? (
        <EmptyState
          title="Pick the enemy champion"
          detail="Choose who you're up against and we'll rank the champions with the best record into them."
        />
      ) : counters.isLoading ? (
        <Loading label="Finding counters…" />
      ) : counters.isError || (counters.data?.counters.length ?? 0) === 0 ? (
        <EmptyState
          title={`No counter data for ${enemy?.name ?? 'that champion'} yet`}
          detail="Either the dataset hasn't been crawled yet, or this matchup is below the minimum sample size."
        />
      ) : (
        <div>
          <p className="mb-2 text-sm text-text-secondary">
            Best picks into <span className="font-semibold text-text-primary">{enemy?.name}</span>:
          </p>
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-default">
            {counters.data!.counters.map((c) => {
              const m = index.get(c.championKey);
              if (!m) return null;
              return (
                <li key={c.championKey}>
                  <a
                    href={`/champion/${m.id}`}
                    className="grid grid-cols-[40px_auto_1fr_auto] items-center gap-3 bg-bg-surface px-3 py-2 transition-colors duration-150 hover:bg-bg-elevated"
                  >
                    <ChampionPortrait championId={m.id} name={m.name} version={version} size={40} />
                    <TierBadge tier={c.tier} grade={assignFullTier(c.winRate, c.games)} size="sm" />
                    <span className="truncate text-sm font-medium text-text-primary">{m.name}</span>
                    <span className="flex items-center gap-3">
                      <ConfidenceChip games={c.games} />
                      <span className="stat text-sm font-semibold text-positive">
                        {formatPercent(c.winRate)}
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
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
