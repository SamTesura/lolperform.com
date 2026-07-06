import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_RANK_BRACKET,
  DEFAULT_REGION,
  ROLE_LABELS,
  type ChampionMeta,
  type RankBracket,
  type Region,
  type Role,
} from '@lolperform/shared';
import { fetchChampion, fetchMeta } from '../../lib/api';
import { ChampionPortrait } from '../primitives/ChampionPortrait';
import { RegionRankControls } from './Controls';
import { QueryProvider } from './QueryProvider';
import { EmptyState, Loading } from './States';
import { formatPercent } from '../../lib/format';

interface Params {
  self: string;
  opp: string;
  role: string;
}

function verdict(winRate: number): { label: string; tone: string } {
  if (winRate >= 0.52) return { label: 'Favored', tone: 'text-positive' };
  if (winRate <= 0.48) return { label: 'Unfavored', tone: 'text-negative' };
  return { label: 'Even', tone: 'text-text-secondary' };
}

function Side({
  champ,
  version,
  winRate,
  games,
}: {
  champ: ChampionMeta;
  version?: string;
  winRate: number;
  games: number;
}) {
  const v = verdict(winRate);
  return (
    <a
      href={`/champion/${champ.id}`}
      className="flex flex-1 flex-col items-center gap-2 rounded-lg border border-border-subtle bg-bg-surface p-4 transition-colors hover:bg-bg-elevated"
    >
      <ChampionPortrait championId={champ.id} name={champ.name} version={version} size={72} />
      <span className="text-sm font-semibold text-text-primary">{champ.name}</span>
      <span className={`stat text-2xl font-bold ${winRate >= 0.5 ? 'text-positive' : 'text-negative'}`}>
        {formatPercent(winRate)}
      </span>
      <span className={`text-xs font-medium ${v.tone}`}>{v.label}</span>
      <span className="text-2xs text-text-muted">{games.toLocaleString('en-US')} games</span>
    </a>
  );
}

function Matchup() {
  const [params, setParams] = useState<Params | null>(null);
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [rank, setRank] = useState<RankBracket>(DEFAULT_RANK_BRACKET);

  // Read the pair from the URL only after mount (this island renders client-side).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setParams({ self: p.get('self') ?? '', opp: p.get('opp') ?? '', role: p.get('role') ?? '' });
  }, []);

  const meta = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const champ = useQuery({
    queryKey: ['champion', params?.self, region, rank],
    queryFn: () => fetchChampion(params!.self, region, rank),
    enabled: Boolean(params?.self),
    retry: false,
  });

  if (!params) return <Loading label="Loading matchup…" />;
  if (!params.self || !params.opp) {
    return (
      <EmptyState
        title="No matchup selected"
        detail="Open a matchup from a champion page or the bot-lane tools to see the head-to-head."
      />
    );
  }

  const byId = new Map<string, ChampionMeta>(
    (meta.data?.champions ?? []).map((c) => [c.id, c]),
  );
  const version = meta.data?.version;
  const selfMeta = byId.get(params.self);
  const oppMeta = byId.get(params.opp);

  if (champ.isLoading || meta.isLoading) return <Loading label="Loading matchup…" />;
  if (!selfMeta || !oppMeta) {
    return <EmptyState title="Unknown champion" detail="That champion id wasn't recognised." />;
  }

  const role = (params.role || undefined) as Role | undefined;
  const rows = champ.data?.matchups ?? [];
  const m =
    rows.find((r) => r.opponentKey === oppMeta.key && (!role || r.role === role)) ??
    rows.find((r) => r.opponentKey === oppMeta.key);
  // If the URL didn't pin a valid role, we fell back to the biggest-sample row —
  // say so instead of letting it read like the user's chosen lane.
  const roleInferred = Boolean(m && m.role !== role);

  if (!m) {
    return (
      <div className="space-y-4">
        <RegionRankControls region={region} rank={rank} onRegion={setRegion} onRank={setRank} />
        <EmptyState
          title={`No data for ${selfMeta.name} vs ${oppMeta.name} yet`}
          detail="This lane matchup is below the minimum sample size in the current dataset. It fills in as more games are crawled."
        />
      </div>
    );
  }

  // Same game pool, opposite perspective — computed from the stored counts so
  // it's exact, rather than 1 - winRate off a possibly-rounded REAL.
  const selfWr = m.winRate;
  const oppWr = m.games > 0 ? (m.games - m.wins) / m.games : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RegionRankControls region={region} rank={rank} onRegion={setRegion} onRank={setRank} />
        <p className="text-xs text-text-muted">
          {ROLE_LABELS[m.role]}
          {roleInferred ? ' (largest sample)' : ''} · {m.games.toLocaleString('en-US')} games
        </p>
      </div>

      <div className="flex items-stretch gap-3">
        <Side champ={selfMeta} version={version} winRate={selfWr} games={m.games} />
        <div className="flex items-center px-1 text-sm font-bold text-text-muted">vs</div>
        <Side champ={oppMeta} version={version} winRate={oppWr} games={m.games} />
      </div>

      <p className="text-sm text-text-secondary">
        Over <span className="stat font-semibold text-text-primary">{m.games.toLocaleString('en-US')}</span>{' '}
        games in {ROLE_LABELS[m.role]}, <span className="font-semibold text-text-primary">{selfMeta.name}</span>{' '}
        wins <span className="stat font-semibold text-text-primary">{formatPercent(selfWr)}</span> of the lane
        against <span className="font-semibold text-text-primary">{oppMeta.name}</span>. Win rates use the same
        game pool from both perspectives.
      </p>
    </div>
  );
}

export default function MatchupDetail() {
  return (
    <QueryProvider>
      <Matchup />
    </QueryProvider>
  );
}
