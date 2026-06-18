import { formatDelta } from '../../lib/format';

const TONE = {
  up: 'text-delta-up',
  down: 'text-delta-down',
  flat: 'text-delta-flat',
} as const;

interface Props {
  /** Win-rate change vs previous patch, as an absolute proportion (e.g. +0.008). */
  delta: number | null | undefined;
}

/** Patch-over-patch trend. Arrow glyph is primary; color reinforces; label for AT. */
export function DeltaBadge({ delta }: Props) {
  const d = formatDelta(delta);
  if (!d) return null;
  return (
    <span className={`stat-mono inline-flex items-center gap-0.5 ${TONE[d.trend]}`}>
      <span aria-hidden>{d.glyph}</span>
      <span>{d.text}</span>
      <span className="sr-only">{d.label}</span>
    </span>
  );
}
