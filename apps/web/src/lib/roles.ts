import type { Role } from '@lolperform/shared';

/**
 * URL slugs for the five roles — the names players actually say, so shared
 * links read naturally: /tier-list/support, /tier-list/bot.
 */
export const ROLE_SLUGS: Record<Role, string> = {
  TOP: 'top',
  JUNGLE: 'jungle',
  MIDDLE: 'mid',
  BOTTOM: 'bot',
  UTILITY: 'support',
};

const BY_SLUG = new Map<string, Role>(
  (Object.entries(ROLE_SLUGS) as [Role, string][]).map(([role, slug]) => [slug, role]),
);

export function roleForSlug(slug: string): Role | undefined {
  return BY_SLUG.get(slug.toLowerCase());
}
