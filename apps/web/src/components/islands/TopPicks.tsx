import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_RANK_BRACKET, DEFAULT_REGION, ROLE_LABELS, type Role } from '@lolperform/shared';
import { fetchMeta, fetchTierList } from '../../lib/api';
import { championIndex } from '../../lib/champions';
import { TierTile } from '../primitives/TierTile';
import { RoleTabsInteractive } from './Controls';
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

  return (
    <div className="space-y-3">
      {/* The site's own role tabs, not a second bespoke style — a role switcher
          should look the same here as it does on the tier list. */}
      <RoleTabsInteractive value={role} onChange={setRole} />
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
