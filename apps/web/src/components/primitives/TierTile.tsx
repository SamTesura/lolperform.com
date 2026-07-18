import { baseTier, confidenceLevel, type ChampionMeta, type RoleStats } from '@lolperform/shared';
import { ChampionPortrait } from './ChampionPortrait';
import { DeltaBadge } from './DeltaBadge';
import { TierBadge } from './TierBadge';
import { formatPercent } from '../../lib/format';

/** Map sample size to the .confidence-* wrapper class from global.css. */
function confidenceClass(games: number): string {
  const level = confidenceLevel(games);
  if (level === 'high') return 'confidence-high';
  if (level === 'medium') return 'confidence-medium';
  return 'confidence-low';
}

interface Props {
  stat: RoleStats;
  meta: ChampionMeta;
  version?: string;
  href?: string;
  /** Below the games floor: show the numbers but no (misleading) tier grade. */
  unranked?: boolean;
}

/**
 * One champion in one tier row. Reads as a single glance: portrait (tier ring),
 * win rate (largest), pick/ban, and a patch-delta corner badge. The whole tile
 * is a link into the champion page.
 */
export function TierTile({ stat, meta, version, href, unranked }: Props) {
  const winning = stat.winRate >= 0.5;
  return (
    <a
      href={href ?? `/champion/${meta.id}`}
      className="group relative flex w-[72px] flex-col gap-1 rounded-md border border-border-default bg-bg-surface p-1.5 transition-[transform,background-color] duration-150 ease-out hover:-translate-y-0.5 hover:bg-bg-elevated hover:shadow-md sm:w-[88px]"
    >
      {!unranked ? (
        <div className="absolute top-1 left-1 z-10">
          <TierBadge tier={baseTier(stat.tier)} grade={stat.tier} size="sm" provisional={stat.provisional} />
        </div>
      ) : null}
      <div className="absolute top-1 right-1 z-10">
        <DeltaBadge delta={stat.deltaWinRate} />
      </div>

      <ChampionPortrait
        championId={meta.id}
        name={meta.name}
        version={version}
        tier={unranked ? undefined : baseTier(stat.tier)}
        size={76}
        className={`h-[60px] w-[60px] sm:h-[76px] sm:w-[76px] ${confidenceClass(stat.games)}`}
      />

      <div className="flex items-baseline justify-between px-0.5">
        <span
          className={`stat text-sm font-semibold ${winning ? 'text-positive' : 'text-negative'}`}
        >
          <span aria-hidden className="mr-0.5">
            {winning ? '▲' : '▼'}
          </span>
          {formatPercent(stat.winRate)}
          <span className="sr-only">{winning ? ' winning' : ' losing'}</span>
        </span>
      </div>

      <div className="flex items-center justify-between px-0.5 text-2xs text-text-muted">
        <span className="stat" title="Pick rate">
          P {formatPercent(stat.pickRate)}
        </span>
        <span className="stat" title="Ban rate">
          B {formatPercent(stat.banRate)}
        </span>
      </div>

      <span className="truncate px-0.5 text-2xs text-text-secondary" title={meta.name}>
        {meta.name}
      </span>
    </a>
  );
}
