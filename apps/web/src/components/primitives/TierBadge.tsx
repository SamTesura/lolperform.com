import type { TierGrade } from '@lolperform/shared';

const TIER_BG: Record<TierGrade, string> = {
  S: 'bg-tier-s text-tier-s-fg',
  A: 'bg-tier-a text-tier-a-fg',
  B: 'bg-tier-b text-tier-b-fg',
  C: 'bg-tier-c text-tier-c-fg',
  D: 'bg-tier-d text-tier-d-fg',
};

const SIZES = {
  sm: 'h-5 min-w-5 px-1 text-xs',
  md: 'h-7 min-w-7 px-1.5 text-sm',
  lg: 'h-10 min-w-10 px-2 text-xl',
} as const;

interface Props {
  /** Base tier letter — drives the colour. */
  tier: TierGrade;
  /** Full grade to display, e.g. "S+". Defaults to the base letter. */
  grade?: string;
  size?: keyof typeof SIZES;
  /** Blended with the prior patch because this patch's sample hasn't matured yet. */
  provisional?: boolean;
}

/** The tier grade on its tier fill. Letter is the primary channel; hue reinforces. */
export function TierBadge({ tier, grade, size = 'md', provisional }: Props) {
  const label = grade ?? tier;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-display font-bold ${TIER_BG[tier]} ${SIZES[size]} ${provisional ? 'border border-dashed border-current' : ''}`}
      aria-label={`Tier ${label}${provisional ? ' (provisional — early data)' : ''}`}
      title={provisional ? 'Provisional: this patch’s sample is still small, blended with the prior patch' : undefined}
    >
      {label}
    </span>
  );
}
