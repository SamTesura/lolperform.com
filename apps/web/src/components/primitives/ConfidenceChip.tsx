import { confidenceLevel, type ConfidenceLevel } from '@lolperform/shared';
import { formatSample } from '../../lib/format';

/** Collapse the 4 data levels into the 3 visual treatments from the design spec. */
function visual(level: ConfidenceLevel): 'high' | 'medium' | 'low' {
  if (level === 'high') return 'high';
  if (level === 'medium') return 'medium';
  return 'low'; // 'low' and 'insufficient' both render as the warning treatment
}

interface Props {
  games: number;
}

/**
 * The honesty badge — rendered next to any stat that has a sample size.
 * Sample size is shown verbatim; low samples get a ⚠ and a warning style so a
 * 12-game win rate can never be mistaken for a 12,000-game one.
 */
export function ConfidenceChip({ games }: Props) {
  const level = visual(confidenceLevel(games));

  if (level === 'high') {
    return (
      <span className="stat inline-flex items-center gap-1 rounded-sm border border-border-subtle bg-bg-elevated px-1.5 py-0.5 text-2xs text-text-muted">
        {formatSample(games)}
      </span>
    );
  }

  if (level === 'medium') {
    return (
      <span className="stat inline-flex items-center gap-1 rounded-sm border border-border-strong bg-bg-elevated px-1.5 py-0.5 text-2xs text-text-muted">
        <span className="text-info" aria-hidden>
          ⓘ
        </span>
        {formatSample(games)}
      </span>
    );
  }

  return (
    <span className="stat inline-flex items-center gap-1 rounded-sm border border-warning bg-warning-subtle px-1.5 py-0.5 text-2xs text-warning">
      <span aria-hidden>⚠</span>
      <span>low sample · {formatSample(games)}</span>
    </span>
  );
}
