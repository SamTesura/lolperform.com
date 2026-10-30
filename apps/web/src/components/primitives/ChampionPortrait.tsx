import type { TierGrade } from '@lolperform/shared';
import { championSquare } from '../../lib/ddragon';

const RING: Record<TierGrade, string> = {
  S: 'ring-tier-s',
  A: 'ring-tier-a',
  B: 'ring-tier-b',
  C: 'ring-tier-c',
  D: 'ring-tier-d',
};

interface Props {
  championId: string;
  name: string;
  version?: string;
  size?: number;
  /** Override the alt text. Pass "" when the name is already printed next to
   *  the portrait (e.g. inside a link), so screen readers don't say it twice. */
  alt?: string;
  /** When set, draws a 2px inner ring in the tier hue. */
  tier?: TierGrade;
  className?: string;
}

/** Square champion portrait from Data Dragon, with an optional tier-coded ring. */
export function ChampionPortrait({
  championId,
  name,
  alt,
  version,
  size = 64,
  tier,
  className,
}: Props) {
  return (
    <img
      src={championSquare(championId, version)}
      alt={alt ?? name}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={`rounded-md bg-bg-inset ${tier ? `ring-2 ring-inset ${RING[tier]}` : ''} ${className ?? ''}`}
    />
  );
}
