import { toPercent } from '@lolperform/shared';

/** "54.2%" — fixed one-decimal percentage from a 0..1 proportion. */
export function formatPercent(value: number, decimals = 1): string {
  return `${toPercent(value, decimals).toFixed(decimals)}%`;
}

/** "12,840" — grouped integer. */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** "n = 12,840" — sample-size label used by the confidence chip. */
export function formatSample(games: number): string {
  return `n = ${formatCount(games)}`;
}

export type Trend = 'up' | 'down' | 'flat';

export interface DeltaDisplay {
  trend: Trend;
  glyph: string;
  /** Signed, percentage-point formatted, e.g. "+0.8" (already ×100). */
  text: string;
  /** Accessible phrasing for screen readers / the visually-hidden label. */
  label: string;
}

/**
 * Format a patch-over-patch win-rate delta (absolute proportion, e.g. +0.008)
 * into a glyph + value. Trend is the primary channel; color is reinforcement.
 * Flat below 0.05 percentage points to avoid noise.
 */
export function formatDelta(delta: number | null | undefined): DeltaDisplay | null {
  if (delta === null || delta === undefined) return null;
  const points = delta * 100;
  if (Math.abs(points) < 0.05) {
    return { trend: 'flat', glyph: '—', text: '0.0', label: 'no change vs last patch' };
  }
  const up = points > 0;
  const signed = `${up ? '+' : '−'}${Math.abs(points).toFixed(1)}`;
  return {
    trend: up ? 'up' : 'down',
    glyph: up ? '▲' : '▼',
    text: signed,
    label: `${up ? 'up' : 'down'} ${Math.abs(points).toFixed(1)} points vs last patch`,
  };
}
