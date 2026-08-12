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
import { ROLE_SLUGS } from '../../lib/roles';
import { TierBadge } from '../primitives/TierBadge';
import { TierTile } from '../primitives/TierTile';
import { RegionRankControls, RoleTabsInteractive } from './Controls';
import { QueryProvider } from './QueryProvider';
import { AWAITING_DATA, EmptyState, Loading } from './States';

function Grid({ initialRole }: { initialRole?: Role }) {
  const [role, setRole] = useState<Role>(initialRole ?? 'BOTTOM');

  // Keep the address bar pointing at the role being viewed, so the current
  // list is always shareable — /tier-list/support and friends are real
  // prerendered pages, and switching tabs swaps to that page's URL without a
  // reload.
  const selectRole = (next: Role) => {
    setRole(next);
    if (typeof history !== 'undefined') {
      history.replaceState(null, '', `/tier-list/${ROLE_SLUGS[next]}`);
    }
  };
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

  // Only show champions the shared grader actually ranked. gradeSlice scores
  // ranked rows in (0, 1] and everything else negative — that already accounts
  // for provisional (prior-patch-blended) rows entering the pool early, so
  // score > 0 is the single source of truth here, not a games threshold.
  const ranked = champions.filter((c) => c.score > 0).sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-4">
      <RoleTabsInteractive value={role} onChange={selectRole} />
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
          detail={`Champions are ranked past ${TIER_LIST_MIN_GAMES.toLocaleString('en-US')} games this patch, or earlier once blended with the prior patch. Neither is ready yet on this slice — the largest sample so far is ${Math.max(...champions.map((c) => c.games)).toLocaleString('en-US')} games — single regions fill slowly; All Regions pools every ladder and fills first.`}
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
                    return (
                      <TierTile key={stat.championKey} stat={stat} meta={m} version={version} />
                    );
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

export default function TierGrid({ initialRole }: { initialRole?: Role }) {
  return (
    <QueryProvider>
      <Grid initialRole={initialRole} />
    </QueryProvider>
  );
}
