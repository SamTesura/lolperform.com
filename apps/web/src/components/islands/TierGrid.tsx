import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  assignTier,
  DEFAULT_RANK_BRACKET,
  DEFAULT_REGION,
  isRanked,
  MIN_TIER_GAMES,
  TIER_GRADES,
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

  // Group by a tier derived from win rate + sample (the single source of truth in
  // shared/tier.ts), not the stored letter — so logic changes show on existing
  // data, and champions below the games floor go to "Unranked" instead of D−.
  const ranked = champions
    .filter((c) => isRanked(c.games))
    .sort((a, b) => b.score - a.score);
  const unranked = champions
    .filter((c) => !isRanked(c.games))
    .sort((a, b) => b.games - a.games);

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
      ) : (
        <div className="space-y-2">
          {TIER_GRADES.map((grade) => {
            const rows = ranked.filter((c) => assignTier(c.winRate, c.games) === grade);
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

          {unranked.length > 0 ? (
            <section className="flex flex-col gap-2 rounded-lg border border-dashed border-border-subtle bg-bg-surface/60 p-3 sm:flex-row sm:gap-3">
              <div className="shrink-0 sm:w-12 sm:pt-1">
                <span className="inline-flex items-center rounded-md border border-border-default px-2 py-1 text-xs font-semibold text-text-muted">
                  NR
                </span>
              </div>
              <div className="min-w-0">
                <p className="mb-2 text-xs text-text-muted">
                  Unranked — under {MIN_TIER_GAMES} games this patch. Win rates here are too
                  small to grade; they fill in as the sample grows.
                </p>
                <div className="flex flex-wrap gap-2">
                  {unranked.map((stat) => {
                    const m = index.get(stat.championKey);
                    if (!m) return null;
                    return (
                      <TierTile key={stat.championKey} stat={stat} meta={m} version={version} unranked />
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}
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
