/**
 * Skill floor: how much mechanical mastery a champion demands before its win
 * rate is achievable. A low floor means the listed rate is repeatable by almost
 * anyone (a 48% Caitlyn is a safer pick than a 48% Aphelios); a high floor
 * means dedicated players earn it. Grading applies it as a small, bounded nudge.
 *
 * Curated because Data Dragon `info.difficulty` is unusable (Caitlyn 6, Garen 5,
 * Varus 2). Reviewed across all 173 champions in July 2026: each entry needs two
 * agreeing signals from community difficulty tables, hardest/easiest consensus
 * lists and Riot's design framing. Contested champions stay neutral. Keyed by
 * Data Dragon id.
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
  // Simple, forgiving kits: the win rate travels to everyone who picks them.
  'Amumu',
  'Annie',
  'Ashe',
  'Blitzcrank',
  'Brand',
  'Braum',
  'Caitlyn',
  'Chogath',
  'Darius',
  'DrMundo',
  'Garen',
  'Illaoi',
  'Janna',
  'Jax',
  'Jinx',
  'Karma',
  'Karthus',
  'Kayle',
  'KogMaw',
  'Leona',
  'Lux',
  'Malphite',
  'Malzahar',
  'Maokai',
  'MasterYi',
  'Milio',
  'MissFortune',
  'MonkeyKing',
  'Mordekaiser',
  'Morgana',
  'Naafiri',
  'Nami',
  'Nasus',
  'Nautilus',
  'Nocturne',
  'Nunu',
  'Olaf',
  'Pantheon',
  'Rammus',
  'Renekton',
  'Sejuani',
  'Seraphine',
  'Sett',
  'Shyvana',
  'Sion',
  'Sivir',
  'Skarner',
  'Smolder',
  'Sona',
  'Soraka',
  'Swain',
  'TahmKench',
  'Teemo',
  'Tristana',
  'Trundle',
  'Tryndamere',
  'Udyr',
  'Varus',
  'Veigar',
  'Vex',
  'Vi',
  'Volibear',
  'Warwick',
  'XinZhao',
  'Yorick',
  'Yuumi',
  'Zaahen',
  'Zac',
  'Ziggs',
  'Zyra',
];

const HIGH: string[] = [
  // Mechanically demanding: specialists carry the ladder win rate.
  'Akali',
  'Akshan',
  'Ambessa',
  'Anivia',
  'Aphelios',
  'Azir',
  'Bard',
  'Camille',
  'Cassiopeia',
  'Draven',
  'Elise',
  'Fiora',
  'Gangplank',
  'Gnar',
  'Hwei',
  'Irelia',
  'Jayce',
  'Kaisa',
  'Kalista',
  'Katarina',
  'Kindred',
  'KSante',
  'Leblanc',
  'LeeSin',
  'Nidalee',
  'Orianna',
  'Pyke',
  'Qiyana',
  'Rengar',
  'Riven',
  'Ryze',
  'Samira',
  'Shaco',
  'Sylas',
  'Syndra',
  'Taliyah',
  'Thresh',
  'Vayne',
  'Viego',
  'Yasuo',
  'Yone',
  'Zed',
  'Zeri',
  'Zoe',
];

export const SKILL_FLOORS: Readonly<Record<string, SkillFloor>> = Object.fromEntries([
  ...LOW.map((id) => [id, 'low'] as const),
  ...HIGH.map((id) => [id, 'high'] as const),
]);

export function skillFloorFor(ddragonId: string): SkillFloor {
  return SKILL_FLOORS[ddragonId] ?? 'medium';
}
