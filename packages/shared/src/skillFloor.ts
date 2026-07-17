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
 * is not usable — it rates Caitlyn 6 vs Garen 5 and Varus 2. Full-roster review
 * (July 2026, all 173 champions): each entry needs at least two agreeing
 * signals among community difficulty tables, hardest/easiest-champion consensus
 * lists, and Riot's own design framing for recent releases (Milio, Naafiri and
 * Vex simple by design; Zaahen a "simple but deadly stat checker"; Locke and
 * Yunara stated medium). Contested champions stay neutral. Keyed by Data
 * Dragon id.
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
  'Amumu', 'Annie', 'Ashe', 'Blitzcrank', 'Brand', 'Braum', 'Caitlyn',
  'Chogath', 'Darius', 'DrMundo', 'Garen', 'Illaoi', 'Janna', 'Jax', 'Jinx',
  'Karma', 'Karthus', 'Kayle', 'KogMaw', 'Leona', 'Lux', 'Malphite',
  'Malzahar', 'Maokai', 'MasterYi', 'Milio', 'MissFortune', 'MonkeyKing',
  'Mordekaiser', 'Morgana', 'Naafiri', 'Nami', 'Nasus', 'Nautilus',
  'Nocturne', 'Nunu', 'Olaf', 'Pantheon', 'Rammus', 'Renekton', 'Sejuani',
  'Seraphine', 'Sett', 'Shyvana', 'Sion', 'Sivir', 'Skarner', 'Smolder',
  'Sona', 'Soraka', 'Swain', 'TahmKench', 'Teemo', 'Tristana', 'Trundle',
  'Tryndamere', 'Udyr', 'Varus', 'Veigar', 'Vex', 'Vi', 'Volibear',
  'Warwick', 'XinZhao', 'Yorick', 'Yuumi', 'Zaahen', 'Zac', 'Ziggs', 'Zyra',
];

const HIGH: string[] = [
  // Mechanically demanding — the ladder win rate is carried by specialists.
  'Akali', 'Akshan', 'Ambessa', 'Anivia', 'Aphelios', 'Azir', 'Bard',
  'Camille', 'Cassiopeia', 'Draven', 'Elise', 'Fiora', 'Gangplank', 'Gnar',
  'Hwei', 'Irelia', 'Jayce', 'Kaisa', 'Kalista', 'Katarina', 'Kindred',
  'KSante', 'Leblanc', 'LeeSin', 'Nidalee', 'Orianna', 'Pyke', 'Qiyana',
  'Rengar', 'Riven', 'Ryze', 'Samira', 'Shaco', 'Sylas', 'Syndra', 'Taliyah',
  'Thresh', 'Vayne', 'Viego', 'Yasuo', 'Yone', 'Zed', 'Zeri', 'Zoe',
];

export const SKILL_FLOORS: Readonly<Record<string, SkillFloor>> = Object.fromEntries([
  ...LOW.map((id) => [id, 'low'] as const),
  ...HIGH.map((id) => [id, 'high'] as const),
]);

export function skillFloorFor(ddragonId: string): SkillFloor {
  return SKILL_FLOORS[ddragonId] ?? 'medium';
}
