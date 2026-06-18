import type { ReactNode } from 'react';

type Tone = 'neutral' | 'positive' | 'negative' | 'warning';

const TONE_BORDER: Record<Tone, string> = {
  neutral: 'border-border-subtle bg-bg-elevated',
  positive: 'border-positive bg-positive-subtle',
  negative: 'border-negative bg-negative-subtle',
  warning: 'border-warning bg-warning-subtle',
};

const TONE_VALUE: Record<Tone, string> = {
  neutral: 'text-text-primary',
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
};

interface Props {
  label: string;
  value: ReactNode;
  tone?: Tone;
  /** Optional leading glyph (e.g. ▲ for a win-positive stat). */
  glyph?: string;
}

/** A small labelled statistic chip. */
export function StatBadge({ label, value, tone = 'neutral', glyph }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 ${TONE_BORDER[tone]}`}
    >
      <span className="text-2xs font-medium tracking-[0.08em] text-text-muted uppercase">{label}</span>
      <span className={`stat text-sm font-semibold ${TONE_VALUE[tone]}`}>
        {glyph ? (
          <span aria-hidden className="mr-0.5">
            {glyph}
          </span>
        ) : null}
        {value}
      </span>
    </span>
  );
}
