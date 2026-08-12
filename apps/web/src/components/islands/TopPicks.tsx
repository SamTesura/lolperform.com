import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_RANK_BRACKET,
  DEFAULT_REGION,
  ROLES,
  ROLE_LABELS,
  type Role,
} from '@lolperform/shared';
import { fetchMeta, fetchTierList } from '../../lib/api';
import { championIndex } from '../../lib/champions';
import { TierTile } from '../primitives/TierTile';
import { QueryProvider } from './QueryProvider';
import { AWAITING_DATA, EmptyState, Loading } from './States';

function Picks() {
  // Bot lane leads because it is the specialty, but every lane is one tap away
  // — the landing page promises all five roles and has to deliver them.
  const [role, setRole] = useState<Role>('BOTTOM');

  const meta = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const tiers = useQuery({
    queryKey: ['tierlist', DEFAULT_REGION, DEFAULT_RANK_BRACKET, role],
    queryFn: () => fetchTierList(DEFAULT_REGION, DEFAULT_RANK_BRACKET, role),
    retry: false,
  });

  const index = meta.data ? championIndex(meta.data.champions) : new Map();
  const version = meta.data?.version;
  const top = (tiers.data?.champions ?? []).filter((c) => c.score > 0).slice(0, 8);

  const tabs = (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Role">
      {ROLES.map((r) => {
        const active = r === role;
        return (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setRole(r)}
            className={`rounded-md border px-2.5 py-1 text-xs transition-colors duration-150 ${
              active
                ? 'border-accent bg-bg-elevated text-text-primary'
                : 'border-border-subtle text-text-muted hover:text-text-primary'
            }`}
          >
            {ROLE_LABELS[r]}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-3">
      {tabs}
      {tiers.isLoading ? (
        <Loading label={`Loading top ${ROLE_LABELS[role].toLowerCase()} picks…`} />
      ) : tiers.isError || top.length === 0 ? (
        <EmptyState {...AWAITING_DATA} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {top.map((stat) => {
            const m = index.get(stat.championKey);
            if (!m) return null;
            return <TierTile key={stat.championKey} stat={stat} meta={m} version={version} />;
          })}
        </div>
      )}
    </div>
  );
}

export default function TopPicks() {
  return (
    <QueryProvider>
      <Picks />
    </QueryProvider>
  );
}
