import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  baseTier,
  DEFAULT_RANK_BRACKET,
  DEFAULT_REGION,
  TIER_GRADES,
  TIER_LIST_MIN_GAMES,
  type RankBracket,
  type Region,
  type Role,
} from '@lolperform/shared';
import { fetchMeta, fetchTierList } from '../../lib/api';
import { championIndex } from '../../lib/champions';
import { TierBadge } from '../primitives/TierBadge';
import { TierTile } from '../primitives/TierTile';
import { RegionRankControls, RoleTabsInteractive } from './Controls';
import { QueryProvider } from './QueryProvider';
import { AWAITING_DATA, EmptyState, Loading } from './States';

function Grid() {
  const [role, setRole] = useState<Role>('BOTTOM');
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [rank, setRank] = useState<RankBracket>(DEFAULT_RANK_BRACKET);

  const meta = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const tiers = useQuery({
    queryKey: ['tierlist', region, rank, role],
    queryFn: () => fetchTierList(region, rank, role),
    retry: false,
  });

  const index = meta.data ? championIndex(meta.data.champions) : new Map();
  const version = meta.data?.version;
  const champions = tiers.data?.champions ?? [];

  // Only rank champions with a trustworthy sample. A ranking off a few dozen
  // games is noise, so anything under TIER_LIST_MIN_GAMES is omitted entirely
  // (not shown as "Unranked") until it accumulates enough. Grouped by a tier
  // derived from win rate (the shared source of truth), so logic shows on
  // existing data.
  const ranked = champions
    .filter((c) => c.games >= TIER_LIST_MIN_GAMES)
    .sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-4">
      <RoleTabsInteractive value={role} onChange={setRole} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RegionRankControls region={region} rank={rank} onRegion={setRegion} onRank={setRank} />
        {tiers.data ? (
          <p className="text-xs text-text-muted">
            Patch <span className="stat text-text-secondary">{tiers.data.patch}</span> · ranked solo
          </p>
        ) : null}
      </div>

      {tiers.isLoading ? (
        <Loading label="Loading tier list…" />
      ) : tiers.isError || champions.length === 0 ? (
        <EmptyState {...AWAITING_DATA} />
      ) : ranked.length === 0 ? (
        <EmptyState
          title="Building the sample"
          detail={`Only champions with ${TIER_LIST_MIN_GAMES.toLocaleString('en-US')}+ games this patch are ranked. The largest sample on this slice is ${Math.max(...champions.map((c) => c.games)).toLocaleString('en-US')} games so far — single regions fill slowly; All Regions pools every ladder and fills first.`}
        />
      ) : (
        <div className="space-y-2">
          {TIER_GRADES.map((grade) => {
            const rows = ranked.filter((c) => baseTier(c.tier) === grade);
            if (rows.length === 0) return null;
            return (
              <section
                key={grade}
                className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-bg-surface p-3 sm:flex-row sm:gap-3"
              >
                <div className="shrink-0 sm:pt-1">
                  <TierBadge tier={grade} size="lg" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {rows.map((stat) => {
                    const m = index.get(stat.championKey);
                    if (!m) return null;
                    return <TierTile key={stat.championKey} stat={stat} meta={m} version={version} />;
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TierGrid() {
  return (
    <QueryProvider>
      <Grid />
    </QueryProvider>
  );
}
