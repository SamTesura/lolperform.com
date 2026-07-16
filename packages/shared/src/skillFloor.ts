/**
 * Skill floor — how much mechanical mastery a champion demands before its win
 * rate is achievable — folded into grading as a small, bounded adjustment:
 *
 * - LOW floor: the listed win rate is repeatable by almost anyone who picks
 *   the champion, so it deserves slightly more trust (e.g. Caitlyn: long
 *   range, simple pattern — a 48% Caitlyn is a safer pick than a 48% Aphelios).
 * - HIGH floor: the listed win rate is earned disproportionately by dedicated
 *   players; the average visitor should expect less.
 *
 * Curated (like the counter list) because Riot's Data Dragon `info.difficulty`
 * is not usable — it rates Caitlyn 6 vs Garen 5 and Varus 2. Only champions
 * with strong community consensus are listed; everyone else is neutral.
 * Keyed by Data Dragon id.
 */
export type SkillFloor = 'low' | 'medium' | 'high';

/** Win-rate-equivalent adjustment applied at grading time (±0.4% max). */
export const SKILL_FLOOR_OFFSET = 0.004;

export function skillFloorOffset(floor: SkillFloor | undefined): number {
  if (floor === 'low') return SKILL_FLOOR_OFFSET;
  if (floor === 'high') return -SKILL_FLOOR_OFFSET;
  return 0;
}

const LOW: string[] = [
  // Simple, forgiving kits — the win rate travels to everyone who picks them.
  'Amumu', 'Annie', 'Ashe', 'Brand', 'Braum', 'Caitlyn', 'Darius', 'DrMundo',
  'Garen', 'Illaoi', 'Janna', 'Jinx', 'KogMaw', 'Leona', 'Lux', 'Malphite',
  'Malzahar', 'Maokai', 'MissFortune', 'Mordekaiser', 'Morgana', 'Nasus',
  'Nautilus', 'Nunu', 'Rammus', 'Seraphine', 'Sett', 'Sivir', 'Sona',
  'Soraka', 'Swain', 'TahmKench', 'Teemo', 'Trundle', 'Tryndamere', 'Varus',
  'Veigar', 'Vi', 'Volibear', 'Warwick', 'Yuumi', 'Zyra',
];

const HIGH: string[] = [
  // Mechanically demanding — the ladder win rate is carried by specialists.
  'Akali', 'Akshan', 'Ambessa', 'Anivia', 'Aphelios', 'Azir', 'Camille',
  'Cassiopeia', 'Draven', 'Elise', 'Fiora', 'Gangplank', 'Gnar', 'Hwei',
  'Irelia', 'Jayce', 'Kalista', 'Katarina', 'Kennen', 'KSante', 'Leblanc',
  'LeeSin', 'Nidalee', 'Nilah', 'Qiyana', 'Rengar', 'Riven', 'Samira',
  'Sylas', 'Thresh', 'Vayne', 'Viego', 'Yasuo', 'Yone', 'Zed', 'Zeri',
];

export const SKILL_FLOORS: Readonly<Record<string, SkillFloor>> = Object.fromEntries([
  ...LOW.map((id) => [id, 'low'] as const),
  ...HIGH.map((id) => [id, 'high'] as const),
]);

export function skillFloorFor(ddragonId: string): SkillFloor {
  return SKILL_FLOORS[ddragonId] ?? 'medium';
}
