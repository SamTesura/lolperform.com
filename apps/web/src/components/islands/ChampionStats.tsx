import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  baseTier,
  DEFAULT_RANK_BRACKET,
  DEFAULT_REGION,
  ROLE_LABELS,
  TIER_LIST_MIN_GAMES,
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

  // Item names + one-line descriptions for build tooltips, straight from the
  // same Data Dragon version the icons use. Cached for the session; the build
  // renders fine without it (icons only) if the fetch fails.
  const itemCatalog = useQuery({
    queryKey: ['item-catalog', version],
    enabled: Boolean(version),
    staleTime: Infinity,
    retry: 1,
    queryFn: async (): Promise<Record<string, { name: string; plaintext?: string }>> => {
      const res = await fetch(
        `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`,
      );
      if (!res.ok) throw new Error(`item.json ${res.status}`);
      const json = (await res.json()) as {
        data: Record<string, { name: string; plaintext?: string }>;
      };
      return json.data;
    },
  });

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
                {/* Tiers only past the same 1,000-game floor the tier list uses —
                    otherwise a lane could read "S+" here while the champion is
                    absent from that lane's tier list. Win rate always shows. */}
                {s.games >= TIER_LIST_MIN_GAMES ? (
                  <TierBadge tier={baseTier(s.tier)} grade={s.tier} size="md" />
                ) : (
                  <span
                    className="inline-flex items-center rounded-md border border-border-default px-2 py-1 text-xs font-semibold text-text-muted"
                    title="Fewer than 1,000 games this patch — not tiered until then"
                  >
                    NR
                  </span>
                )}
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

      <section className="space-y-2">
        <h3>Most common build</h3>
        {champBuild ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-bg-surface p-3">
            <div className="flex flex-wrap gap-2">
              {Array.from({
                // Six item slots, seven for bot lane — the support quest item
                // occupies one down there.
                length: champBuild.role === 'BOTTOM' || champBuild.role === 'UTILITY' ? 7 : 6,
              }).map((_, i) => {
                const id = champBuild.items[i];
                const info = id ? itemCatalog.data?.[String(id)] : undefined;
                return id ? (
                  <span key={`${id}-${i}`} className="group relative inline-block">
                    <img
                      src={itemIcon(id, version)}
                      alt={info?.name ?? `Item slot ${i + 1}`}
                      width={40}
                      height={40}
                      loading="lazy"
                      className="rounded-sm bg-bg-inset"
                    />
                    {info ? (
                      <span
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-48 -translate-x-1/2 rounded-md border border-border-default bg-bg-overlay p-2 text-left shadow-lg group-hover:block"
                      >
                        <span className="block text-xs font-semibold text-text-primary">
                          {info.name}
                        </span>
                        {info.plaintext ? (
                          <span className="mt-0.5 block text-2xs leading-snug text-text-muted">
                            {info.plaintext}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <div
                    key={`empty-${i}`}
                    title="No consistent pick for this slot yet"
                    className="h-10 w-10 rounded-sm border border-dashed border-border-subtle bg-bg-inset/50"
                    aria-label={`Item slot ${i + 1}: no consistent pick yet`}
                  />
                );
              })}
            </div>
            <span className="stat text-sm text-text-muted">
              {formatPercent(champBuild.winRate)} win · {champBuild.games.toLocaleString('en-US')} games
            </span>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border-subtle bg-bg-surface/60 p-3 text-sm text-text-muted">
            Build data lands as the sample grows — the crawler refreshes it every few hours.
          </p>
        )}
      </section>
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
