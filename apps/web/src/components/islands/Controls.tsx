import { Crosshair, Shield, Sword, Trees, Wand2 } from 'lucide-react';
import {
  RANK_BRACKETS,
  RANK_BRACKET_LABELS,
  REGIONS,
  REGION_LABELS,
  ROLES,
  ROLE_LABELS,
  type RankBracket,
  type Region,
  type Role,
} from '@lolperform/shared';

const ROLE_ICONS: Record<Role, typeof Sword> = {
  TOP: Sword,
  JUNGLE: Trees,
  MIDDLE: Wand2,
  BOTTOM: Crosshair,
  UTILITY: Shield,
};

export function RoleTabsInteractive({
  value,
  onChange,
}: {
  value: Role;
  onChange: (role: Role) => void;
}) {
  return (
    <nav aria-label="Role" className="flex items-center gap-1 overflow-x-auto border-b border-border-subtle">
      {ROLES.map((role) => {
        const Icon = ROLE_ICONS[role];
        const active = role === value;
        return (
          <button
            key={role}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(role)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors duration-150 ${
              active
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <Icon size={16} aria-hidden />
            {ROLE_LABELS[role]}
          </button>
        );
      })}
    </nav>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-text-muted">
      <span className="uppercase tracking-[0.08em]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-sm border border-border-default bg-bg-elevated px-2 py-1 text-sm text-text-primary"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {labels[o]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RegionRankControls({
  region,
  rank,
  onRegion,
  onRank,
}: {
  region: Region;
  rank: RankBracket;
  onRegion: (r: Region) => void;
  onRank: (r: RankBracket) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Select label="Rank" value={rank} options={RANK_BRACKETS} labels={RANK_BRACKET_LABELS} onChange={onRank} />
      <Select label="Region" value={region} options={REGIONS} labels={REGION_LABELS} onChange={onRegion} />
    </div>
  );
}
