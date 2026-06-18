import type { TierGrade } from '@lolperform/shared';

const TIER_BG: Record<TierGrade, string> = {
  S: 'bg-tier-s text-tier-s-fg',
  A: 'bg-tier-a text-tier-a-fg',
  B: 'bg-tier-b text-tier-b-fg',
  C: 'bg-tier-c text-tier-c-fg',
  D: 'bg-tier-d text-tier-d-fg',
};

const SIZES = {
  sm: 'h-5 w-5 text-xs',
  md: 'h-7 w-7 text-sm',
  lg: 'h-10 w-10 text-xl',
} as const;

interface Props {
  tier: TierGrade;
  size?: keyof typeof SIZES;
}

/** The tier letter on its tier fill. Letter is the primary channel; hue reinforces. */
export function TierBadge({ tier, size = 'md' }: Props) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-display font-bold ${TIER_BG[tier]} ${SIZES[size]}`}
      aria-label={`Tier ${tier}`}
    >
      {tier}
    </span>
  );
}
