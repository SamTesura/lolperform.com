import type { ChampionMeta, Matchup } from '@lolperform/shared';
import { ChampionPortrait } from './ChampionPortrait';
import { ConfidenceChip } from './ConfidenceChip';
import { formatPercent } from '../../lib/format';

/** Neutral verdict copy — color carries the good/bad signal, words stay factual. */
function verdict(winRate: number): { label: string; tone: string; glyph: string } {
  if (winRate >= 0.52) return { label: 'Favored', tone: 'text-positive', glyph: '▲' };
  if (winRate <= 0.48) return { label: 'Unfavored', tone: 'text-negative', glyph: '▼' };
  return { label: 'Even', tone: 'text-text-muted', glyph: '—' };
}

interface Props {
  matchup: Matchup;
  /** The champion whose perspective the win rate is from. */
  self: ChampionMeta;
  opponent: ChampionMeta;
  version?: string;
  striped?: boolean;
}

/** A single "self vs opponent" lane matchup row, linking to the deep matchup page. */
export function MatchupRow({ matchup, self, opponent, version, striped }: Props) {
  const v = verdict(matchup.winRate);
  return (
    <a
      href={`/matchup/${self.id}-vs-${opponent.id}`}
      className={`grid grid-cols-[40px_1fr_auto] items-center gap-3 rounded-sm px-3 py-2 transition-colors duration-150 hover:bg-bg-elevated ${
        striped ? 'bg-bg-surface' : 'bg-bg-base'
      }`}
    >
      <ChampionPortrait championId={opponent.id} name={opponent.name} version={version} size={40} />

      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-text-primary">{opponent.name}</div>
        <div className="text-2xs text-text-muted">{opponent.title}</div>
      </div>

      <div className="flex items-center gap-3">
        <ConfidenceChip games={matchup.games} />
        <div className="text-right">
          <div className={`stat text-sm font-semibold ${v.tone}`}>
            <span aria-hidden className="mr-0.5">
              {v.glyph}
            </span>
            {formatPercent(matchup.winRate)}
          </div>
          <div className={`text-2xs ${v.tone}`}>{v.label}</div>
        </div>
      </div>
    </a>
  );
}
