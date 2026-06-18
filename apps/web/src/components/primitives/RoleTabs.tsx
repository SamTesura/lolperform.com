import { Crosshair, Shield, Sword, Trees, Wand2 } from 'lucide-react';
import { ROLES, ROLE_LABELS, type Role } from '@lolperform/shared';

const ICONS: Record<Role, typeof Sword> = {
  TOP: Sword,
  JUNGLE: Trees,
  MIDDLE: Wand2,
  BOTTOM: Crosshair,
  UTILITY: Shield,
};

interface Props {
  active: Role;
  /** Build the href for each role. Defaults to the tier-list query param form. */
  hrefFor?: (role: Role) => string;
}

/**
 * Broadcast-style role tab strip: an underline marks the active lane (no pill).
 * Presentational — the interactive filtering version lives in a React island.
 */
export function RoleTabs({ active, hrefFor }: Props) {
  return (
    <nav aria-label="Role" className="flex items-center gap-1 border-b border-border-subtle">
      {ROLES.map((role) => {
        const Icon = ICONS[role];
        const isActive = role === active;
        return (
          <a
            key={role}
            href={hrefFor ? hrefFor(role) : `/tier-list?role=${role}`}
            aria-current={isActive ? 'page' : undefined}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors duration-150 ${
              isActive
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <Icon size={16} aria-hidden />
            {ROLE_LABELS[role]}
          </a>
        );
      })}
    </nav>
  );
}
