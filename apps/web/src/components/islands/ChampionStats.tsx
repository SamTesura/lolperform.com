import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  assignFullTier,
  DEFAULT_RANK_BRACKET,
  DEFAULT_REGION,
  ROLE_LABELS,
  type Matchup,
  type RankBracket,
  type Region,
} from '@lolperform/shared';
import { fetchChampion, fetchMeta } from '../../lib/api';
import { championIndex } from '../../lib/champions';
import { itemIcon } from '../../lib/ddragon';
import { MatchupRow } from '../primitives/MatchupRow';
import { StatBadge } from '../primitives/StatBadge';
import { TierBadge } from '../primitives/TierBadge';
import { RegionRankControls } from './Controls';
import { QueryProvider } from './QueryProvider';
import { AWAITING_DATA, EmptyState, Loading } from './States';
import { formatPercent } from '../../lib/format';

/**
 * "Best" holds only matchups the champion actually wins (>50%), "toughest" only
 * ones it loses (<50%), so the two lists are disjoint by construction — with a
 * thin matchup set, a plain sort-and-take-6 from both ends put the same
 * opponents (even favored ones) on both sides. Exactly-even matchups appear in
 * neither.
 */
function topMatchups(matchups: Matchup[], favored: boolean, n = 6): Matchup[] {
  return matchups
    .filter((m) => (favored ? m.winRate > 0.5 : m.winRate < 0.5))
    .sort((a, b) => (favored ? b.winRate - a.winRate : a.winRate - b.winRate))
    .slice(0, n);
}

function Detail({ championId }: { championId: string }) {
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [rank, setRank] = useState<RankBracket>(DEFAULT_RANK_BRACKET);

  const meta = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const champ = useQuery({
    queryKey: ['champion', championId, region, rank],
    queryFn: () => fetchChampion(championId, region, rank),
    retry: false,
  });

  const index = meta.data ? championIndex(meta.data.champions) : new Map();
  const version = meta.data?.version;

  if (champ.isLoading) return <Loading label="Loading champion data…" />;
  if (champ.isError || !champ.data) return <EmptyState {...AWAITING_DATA} />;

  const { meta: self, stats, matchups, synergies, builds } = champ.data;
  // primary role = most games
  const primary = stats.slice().sort((a, b) => b.games - a.games)[0];
  const roleMatchups = primary ? matchups.filter((m) => m.role === primary.role) : matchups;
  const bestMatchups = topMatchups(roleMatchups, true);
  const toughMatchups = topMatchups(roleMatchups, false);
  const champBuild = builds.find((b) => b.opponentKey === null) ?? builds[0];

  return (
    <div className="space-y-6">
      <RegionRankControls region={region} rank={rank} onRegion={setRegion} onRank={setRank} />

      {stats.length === 0 ? (
        <EmptyState {...AWAITING_DATA} />
      ) : (
        <section className="space-y-3">
          <h2>Performance</h2>
          <div className="flex flex-wrap gap-3">
            {stats.map((s) => (
              <div
                key={s.role}
                className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-bg-surface px-3 py-2 sm:w-auto sm:gap-3"
              >
                <TierBadge tier={s.tier} grade={assignFullTier(s.winRate, s.games)} size="md" />
                <span className="text-sm font-medium text-text-secondary">{ROLE_LABELS[s.role]}</span>
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:gap-3">
                  <StatBadge label="Win" value={formatPercent(s.winRate)} tone={s.winRate >= 0.5 ? 'positive' : 'negative'} />
                  <StatBadge label="Pick" value={formatPercent(s.pickRate)} />
                  <StatBadge label="Ban" value={formatPercent(s.banRate)} />
                  <StatBadge label="Games" value={s.games.toLocaleString('en-US')} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {bestMatchups.length > 0 || toughMatchups.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {bestMatchups.length > 0 ? (
            <section className="space-y-2">
              <h3>Best matchups</h3>
              <div className="overflow-hidden rounded-lg border border-border-default">
                {bestMatchups.map((m, i) => {
                  const opp = index.get(m.opponentKey);
                  if (!opp) return null;
                  return <MatchupRow key={m.opponentKey} matchup={m} self={self} opponent={opp} version={version} striped={i % 2 === 1} />;
                })}
              </div>
            </section>
          ) : null}
          {toughMatchups.length > 0 ? (
            <section className="space-y-2">
              <h3>Toughest matchups</h3>
              <div className="overflow-hidden rounded-lg border border-border-default">
                {toughMatchups.map((m, i) => {
                  const opp = index.get(m.opponentKey);
                  if (!opp) return null;
                  return <MatchupRow key={m.opponentKey} matchup={m} self={self} opponent={opp} version={version} striped={i % 2 === 1} />;
                })}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {synergies.length > 0 ? (
        <section className="space-y-2">
          <h3>Bot-lane synergy</h3>
          <div className="flex flex-wrap gap-2">
            {synergies
              .slice()
              .sort((a, b) => b.wilsonLower - a.wilsonLower)
              .slice(0, 8)
              .map((d) => {
                const partnerKey = d.adcKey === self.key ? d.supportKey : d.adcKey;
                const partner = index.get(partnerKey);
                if (!partner) return null;
                return (
                  <span key={partnerKey} className="rounded-sm border border-border-subtle bg-bg-surface px-2 py-1 text-sm">
                    <span className="text-text-secondary">{partner.name}</span>{' '}
                    <span className="stat font-semibold text-positive">{formatPercent(d.winRate)}</span>
                  </span>
                );
              })}
          </div>
        </section>
      ) : null}

      {champBuild ? (
        <section className="space-y-2">
          <h3>Most common build</h3>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-bg-surface p-3">
            {champBuild.items.map((id, i) => (
              <img
                key={`${id}-${i}`}
                src={itemIcon(id, version)}
                alt={`Item ${id}`}
                width={40}
                height={40}
                loading="lazy"
                className="rounded-sm bg-bg-inset"
              />
            ))}
            <span className="stat ml-2 text-sm text-text-muted">{formatPercent(champBuild.winRate)} win · {champBuild.games.toLocaleString('en-US')} games</span>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default function ChampionStats({ championId }: { championId: string }) {
  return (
    <QueryProvider>
      <Detail championId={championId} />
    </QueryProvider>
  );
}
