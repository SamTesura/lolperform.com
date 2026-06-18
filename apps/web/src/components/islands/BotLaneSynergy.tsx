import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_RANK_BRACKET, DEFAULT_REGION, type RankBracket, type Region } from '@lolperform/shared';
import { fetchDuos, fetchMeta } from '../../lib/api';
import { championIndex } from '../../lib/champions';
import { ChampionPortrait } from '../primitives/ChampionPortrait';
import { ConfidenceChip } from '../primitives/ConfidenceChip';
import { RegionRankControls } from './Controls';
import { QueryProvider } from './QueryProvider';
import { AWAITING_DATA, EmptyState, Loading } from './States';
import { formatPercent } from '../../lib/format';

function Synergy() {
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [rank, setRank] = useState<RankBracket>(DEFAULT_RANK_BRACKET);

  const meta = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const duos = useQuery({
    queryKey: ['duos', region, rank],
    queryFn: () => fetchDuos(region, rank),
    retry: false,
  });

  const index = meta.data ? championIndex(meta.data.champions) : new Map();
  const version = meta.data?.version;
  const top = (duos.data?.duos ?? []).slice().sort((a, b) => b.wilsonLower - a.wilsonLower).slice(0, 24);

  return (
    <div className="space-y-4">
      <RegionRankControls region={region} rank={rank} onRegion={setRegion} onRank={setRank} />
      {duos.isLoading ? (
        <Loading label="Loading duo synergy…" />
      ) : duos.isError || top.length === 0 ? (
        <EmptyState {...AWAITING_DATA} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {top.map((d) => {
            const adc = index.get(d.adcKey);
            const sup = index.get(d.supportKey);
            if (!adc || !sup) return null;
            return (
              <div
                key={`${d.adcKey}-${d.supportKey}`}
                className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-surface px-3 py-2"
              >
                <div className="flex -space-x-2">
                  <ChampionPortrait championId={adc.id} name={adc.name} version={version} size={40} />
                  <ChampionPortrait championId={sup.id} name={sup.name} version={version} size={40} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-text-primary">
                    {adc.name} <span className="text-text-muted">+</span> {sup.name}
                  </div>
                  <ConfidenceChip games={d.games} />
                </div>
                <span className="stat text-sm font-semibold text-positive">
                  {formatPercent(d.winRate)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function BotLaneSynergy() {
  return (
    <QueryProvider>
      <Synergy />
    </QueryProvider>
  );
}
