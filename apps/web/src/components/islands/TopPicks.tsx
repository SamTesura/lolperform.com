import { useQuery } from '@tanstack/react-query';
import { DEFAULT_RANK_BRACKET, DEFAULT_REGION, isRanked } from '@lolperform/shared';
import { fetchMeta, fetchTierList } from '../../lib/api';
import { championIndex } from '../../lib/champions';
import { TierTile } from '../primitives/TierTile';
import { QueryProvider } from './QueryProvider';
import { AWAITING_DATA, EmptyState, Loading } from './States';

function Picks() {
  const meta = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const tiers = useQuery({
    queryKey: ['tierlist', DEFAULT_REGION, DEFAULT_RANK_BRACKET, 'BOTTOM'],
    queryFn: () => fetchTierList(DEFAULT_REGION, DEFAULT_RANK_BRACKET, 'BOTTOM'),
    retry: false,
  });

  const index = meta.data ? championIndex(meta.data.champions) : new Map();
  const version = meta.data?.version;
  const top = (tiers.data?.champions ?? []).filter((c) => isRanked(c.games)).slice(0, 8);

  if (tiers.isLoading) return <Loading label="Loading top picks…" />;
  if (tiers.isError || top.length === 0) return <EmptyState {...AWAITING_DATA} />;

  return (
    <div className="flex flex-wrap gap-2">
      {top.map((stat) => {
        const m = index.get(stat.championKey);
        if (!m) return null;
        return <TierTile key={stat.championKey} stat={stat} meta={m} version={version} />;
      })}
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
