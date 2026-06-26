import type { Role } from '@lolperform/shared';

/**
 * Curated lane counters — common, widely-agreed picks INTO a given enemy, keyed
 * by the enemy's Data Dragon id, per role. This is deliberately *editorial*
 * (general game knowledge), not derived from our sampled match data: counter
 * relationships are well known and stable, while per-matchup win rates need far
 * more games than a sampled site has to be trustworthy. The recommender shows
 * these picks and enriches each with its live role win rate when available.
 *
 * `note` is a short "why". Champion ids must match Data Dragon exactly
 * (e.g. Kai'Sa → "Kaisa", Wukong → "MonkeyKing", Cho'Gath → "Chogath").
 */
export interface Counter {
  id: string;
  note?: string;
}

export const COUNTERS: Record<string, Partial<Record<Role, Counter[]>>> = {
  // ---------------- TOP ----------------
  Nasus: {
    TOP: [
      { id: 'Teemo', note: 'Blind + ranged poke denies stacks' },
      { id: 'Quinn', note: 'Ranged harass, roams before he scales' },
      { id: 'Darius', note: 'Wins every early all-in' },
      { id: 'Vayne', note: 'Kites the slow melee' },
    ],
  },
  Darius: {
    TOP: [
      { id: 'Quinn', note: 'Ranged, never lets him touch you' },
      { id: 'Vayne', note: 'Condemn + kite his short range' },
      { id: 'Teemo', note: 'Blind cancels his pull/all-in' },
      { id: 'Gnar', note: 'Pokes in mini, disengages mega' },
    ],
  },
  Garen: {
    TOP: [
      { id: 'Vayne', note: 'Kites, true damage shreds his HP' },
      { id: 'Quinn', note: 'Ranged poke, he can only walk at you' },
      { id: 'Teemo', note: 'Blind + move-speed kite' },
    ],
  },
  Yasuo: {
    TOP: [
      { id: 'Malphite', note: 'Armor + unstoppable ult through windwall' },
      { id: 'Renekton', note: 'Early all-in before he scales' },
      { id: 'Pantheon', note: 'Point-and-click stun, early kill pressure' },
    ],
    MIDDLE: [
      { id: 'Malzahar', note: 'Suppress + voidlings ignore windwall' },
      { id: 'Annie', note: 'Point-click stun he can’t windwall' },
      { id: 'Pantheon', note: 'Early kill pressure, stun lock' },
    ],
  },
  Fiora: {
    TOP: [
      { id: 'Pantheon', note: 'Early burst before her item spikes' },
      { id: 'Jax', note: 'Counter-strike dodges her riposte windows' },
      { id: 'Malphite', note: 'Armor stacking blunts her duels' },
    ],
  },
  Riven: {
    TOP: [
      { id: 'Renekton', note: 'Out-trades her early all-in' },
      { id: 'Pantheon', note: 'Stun + burst punishes her engage' },
      { id: 'Malphite', note: 'Armor + slow shut her down' },
    ],
  },
  Aatrox: {
    TOP: [
      { id: 'Renekton', note: 'Dominates the early all-in window' },
      { id: 'Fiora', note: 'Parries his Q3, duels well' },
      { id: 'Gnar', note: 'Ranged kite, disengages his combo' },
    ],
  },
  Irelia: {
    TOP: [
      { id: 'Pantheon', note: 'Early kill pressure before she snowballs' },
      { id: 'Renekton', note: 'Out-trades level 1-6' },
      { id: 'Malphite', note: 'Armor + ult lock her down' },
    ],
  },
  Camille: {
    TOP: [
      { id: 'Malphite', note: 'Armor stacking ruins her duels' },
      { id: 'Pantheon', note: 'Early burst, point-click stun' },
      { id: 'Olaf', note: 'True damage + ult ignores her CC' },
    ],
  },
  Sett: {
    TOP: [
      { id: 'Vayne', note: 'Kites his short range' },
      { id: 'Quinn', note: 'Ranged poke, roam pressure' },
      { id: 'Gnar', note: 'Pokes and disengages his W' },
    ],
  },
  Mordekaiser: {
    TOP: [
      { id: 'Vayne', note: 'Kites, true damage in the death realm' },
      { id: 'Quinn', note: 'Ranged, outmaneuvers his slow' },
      { id: 'Gangplank', note: 'Barrels + cleanse on crit, hard to pin' },
    ],
  },
  Teemo: {
    TOP: [
      { id: 'Malphite', note: 'Armor + magic resist shrugs off poke' },
      { id: 'DrMundo', note: 'Sustains through the harass' },
      { id: 'Yorick', note: 'Maiden + cage out-pressure him' },
    ],
  },

  // ---------------- JUNGLE ----------------
  MasterYi: {
    JUNGLE: [
      { id: 'Rammus', note: 'Thornmail + taunt melts his autos' },
      { id: 'Malzahar', note: 'Suppress shuts down his ult' },
      { id: 'Lillia', note: 'Kites with sleep, never gets caught' },
    ],
  },
  Kayn: {
    JUNGLE: [
      { id: 'XinZhao', note: 'Wins the early skirmishes before he transforms' },
      { id: 'LeeSin', note: 'Early pressure, invades his clear' },
    ],
  },
  Karthus: {
    JUNGLE: [
      { id: 'LeeSin', note: 'Early ganks/invades punish his slow start' },
      { id: 'Elise', note: 'Early-game bully, dives him' },
      { id: 'Khazix', note: 'Picks him off, snowballs early' },
    ],
  },
  Graves: {
    JUNGLE: [
      { id: 'XinZhao', note: 'Sticks to him, all-in early' },
      { id: 'LeeSin', note: 'Out-duels and invades early' },
    ],
  },

  // ---------------- MID ----------------
  Yone: {
    MIDDLE: [
      { id: 'Malzahar', note: 'Suppress stops his dash combo' },
      { id: 'Annie', note: 'Stun shuts down his all-in' },
      { id: 'Pantheon', note: 'Out-trades him early' },
    ],
  },
  Zed: {
    MIDDLE: [
      { id: 'Malzahar', note: 'Suppress + shield negate his ult' },
      { id: 'Lissandra', note: 'Self-ult dodges his all-in' },
      { id: 'Annie', note: 'Stun shield deletes him on engage' },
    ],
  },
  Katarina: {
    MIDDLE: [
      { id: 'Galio', note: 'Knock-up + MR interrupt her ult' },
      { id: 'Diana', note: 'Out-duels and bursts her' },
      { id: 'Lissandra', note: 'Hard CC stops her reset spree' },
    ],
  },
  Akali: {
    MIDDLE: [
      { id: 'Galio', note: 'MR + taunt punish her dives' },
      { id: 'Lissandra', note: 'CC catches her through shroud' },
      { id: 'Kassadin', note: 'Out-scales and survives her burst' },
    ],
  },
  Fizz: {
    MIDDLE: [
      { id: 'Lissandra', note: 'CC lands despite his E untargetable' },
      { id: 'Malzahar', note: 'Shield + suppress blunt his all-in' },
      { id: 'Annie', note: 'Stun before he can E away' },
    ],
  },
  Kassadin: {
    MIDDLE: [
      { id: 'Talon', note: 'Roams + kills him before level 16' },
      { id: 'Zed', note: 'Bullies his weak early game' },
      { id: 'Pantheon', note: 'Early kill pressure, denies farm' },
    ],
  },
  Veigar: {
    MIDDLE: [
      { id: 'Talon', note: 'Gap-closes past his cage to kill' },
      { id: 'Zed', note: 'All-in before he gets stacks' },
      { id: 'Kassadin', note: 'R dodges the cage, out-scales' },
    ],
  },
  Syndra: {
    MIDDLE: [
      { id: 'Talon', note: 'Dives her, punishes immobility' },
      { id: 'Zed', note: 'Out-trades her short-range poke' },
      { id: 'Fizz', note: 'E dodges her stun combo' },
    ],
  },
  Lux: {
    MIDDLE: [
      { id: 'Talon', note: 'Gap-closes past skillshots' },
      { id: 'Zed', note: 'Punishes her immobility' },
      { id: 'Kassadin', note: 'R dodges her binding' },
    ],
    UTILITY: [
      { id: 'Leona', note: 'Engages past her skillshots' },
      { id: 'Nautilus', note: 'Hard engage onto immobile Lux' },
      { id: 'Pyke', note: 'Dives her squishy lane' },
    ],
  },
  Vladimir: {
    MIDDLE: [
      { id: 'Talon', note: 'Bullies his weak early game' },
      { id: 'Kassadin', note: 'Out-scales, dodges with R' },
      { id: 'Fizz', note: 'Burst through his sustain' },
    ],
  },
  Sylas: {
    MIDDLE: [
      { id: 'Annie', note: 'Stun before he heals off you' },
      { id: 'Malzahar', note: 'Suppress shuts his combo' },
    ],
  },

  // ---------------- BOTTOM (ADC) ----------------
  Draven: {
    BOTTOM: [
      { id: 'Caitlyn', note: 'Out-ranges him, traps deny axe-catching' },
      { id: 'Ashe', note: 'Permaslow stops his snowball' },
      { id: 'Sivir', note: 'Spell shield + waveclear deny his lane' },
    ],
  },
  Caitlyn: {
    BOTTOM: [
      { id: 'Draven', note: 'Out-damages her in a level-2 all-in' },
      { id: 'Lucian', note: 'Burst all-in beats her early' },
      { id: 'Samira', note: 'Dives onto her once she steps up' },
    ],
  },
  Jhin: {
    BOTTOM: [
      { id: 'Draven', note: 'Punishes his reload windows' },
      { id: 'Lucian', note: 'All-in while he’s mid-reload' },
      { id: 'Caitlyn', note: 'Out-ranges his poke' },
    ],
  },
  Jinx: {
    BOTTOM: [
      { id: 'Caitlyn', note: 'Out-ranges her weak early game' },
      { id: 'Draven', note: 'Snowballs before she scales' },
      { id: 'Lucian', note: 'All-in her immobility' },
    ],
  },
  Kaisa: {
    BOTTOM: [
      { id: 'Caitlyn', note: 'Out-ranges her short early range' },
      { id: 'Draven', note: 'Wins lane before her item spikes' },
    ],
  },
  Ezreal: {
    BOTTOM: [
      { id: 'Caitlyn', note: 'Out-ranges his poke' },
      { id: 'MissFortune', note: 'Out-damages him in lane' },
      { id: 'Draven', note: 'Punishes his early weakness' },
    ],
  },
  Vayne: {
    BOTTOM: [
      { id: 'Caitlyn', note: 'Out-ranges her terrible early game' },
      { id: 'Draven', note: 'Snowballs before she scales' },
      { id: 'MissFortune', note: 'Lane bully, denies farm' },
    ],
  },
  Aphelios: {
    BOTTOM: [
      { id: 'Draven', note: 'Punishes his weak early game' },
      { id: 'Caitlyn', note: 'Out-ranges his off-guns' },
      { id: 'Lucian', note: 'Early all-in pressure' },
    ],
  },
  Samira: {
    BOTTOM: [
      { id: 'Caitlyn', note: 'Pokes + traps stop her dashes in' },
      { id: 'Ashe', note: 'Permaslow denies her engage' },
      { id: 'Varus', note: 'Long-range poke before she reaches you' },
    ],
  },
  Twitch: {
    BOTTOM: [
      { id: 'Caitlyn', note: 'Out-ranges and zones him pre-6' },
      { id: 'Draven', note: 'Wins the early game hard' },
      { id: 'Ashe', note: 'Vision-slow stops his stealth roams' },
    ],
  },
  KogMaw: {
    BOTTOM: [
      { id: 'Caitlyn', note: 'Out-ranges his immobile lane' },
      { id: 'Draven', note: 'All-ins before he scales' },
      { id: 'MissFortune', note: 'Poke denies his farm' },
    ],
  },
  Zeri: {
    BOTTOM: [
      { id: 'Draven', note: 'Wins lane before her scaling' },
      { id: 'Caitlyn', note: 'Out-ranges her early' },
    ],
  },

  // ---------------- UTILITY (support) ----------------
  Blitzcrank: {
    UTILITY: [
      { id: 'Morgana', note: 'Black Shield blocks the hook' },
      { id: 'Janna', note: 'Disengage + monsoon undo his grab' },
      { id: 'Milio', note: 'Cleanse + peel save the hooked carry' },
    ],
  },
  Thresh: {
    UTILITY: [
      { id: 'Morgana', note: 'Black Shield eats the hook' },
      { id: 'Janna', note: 'Peels his engage away' },
      { id: 'Lulu', note: 'Polymorph + shield negate his all-in' },
    ],
  },
  Pyke: {
    UTILITY: [
      { id: 'Morgana', note: 'Black Shield blocks hook + stun' },
      { id: 'Janna', note: 'Disengages his roams' },
      { id: 'Lulu', note: 'Peels his all-in off the carry' },
    ],
  },
  Leona: {
    UTILITY: [
      { id: 'Morgana', note: 'Black Shield stops her whole combo' },
      { id: 'Janna', note: 'Knock-up cancels her engage' },
      { id: 'Lulu', note: 'Polymorph shuts her down mid-dive' },
    ],
  },
  Nautilus: {
    UTILITY: [
      { id: 'Morgana', note: 'Black Shield blocks hook + ult' },
      { id: 'Janna', note: 'Disengage undoes his engage' },
    ],
  },
  Senna: {
    UTILITY: [
      { id: 'Leona', note: 'All-in engage before she scales' },
      { id: 'Nautilus', note: 'Hard engage past her poke' },
      { id: 'Pyke', note: 'Dives her squishy backline lane' },
    ],
  },
  Soraka: {
    UTILITY: [
      { id: 'Pyke', note: 'Dive + grievous wounds shut her healing' },
      { id: 'Leona', note: 'All-in kills before she heals' },
      { id: 'Brand', note: 'Burst out-paces her sustain' },
    ],
  },
  Yuumi: {
    UTILITY: [
      { id: 'Blitzcrank', note: 'Hooks the host the instant she detaches' },
      { id: 'Pyke', note: 'Dives the host she can’t protect' },
      { id: 'Brand', note: 'AoE punishes the stacked duo' },
    ],
  },
  Lulu: {
    UTILITY: [
      { id: 'Leona', note: 'Hard engage past her peel' },
      { id: 'Nautilus', note: 'Chain CC overwhelms her shields' },
      { id: 'Pyke', note: 'Picks her off when she steps up' },
    ],
  },
  Nami: {
    UTILITY: [
      { id: 'Leona', note: 'Engages past her bubble' },
      { id: 'Nautilus', note: 'Chain CC out-locks her' },
      { id: 'Pyke', note: 'All-in her squishy lane' },
    ],
  },
  Janna: {
    UTILITY: [
      { id: 'Leona', note: 'Lock-down before she disengages' },
      { id: 'Pyke', note: 'Picks off her carry through the shield' },
    ],
  },
};

export function countersFor(enemyId: string, role: Role): Counter[] {
  return COUNTERS[enemyId]?.[role] ?? [];
}

/** Enemy champion ids that have curated counters for a role (drives the picker). */
export function enemiesWithCounters(role: Role): string[] {
  return Object.keys(COUNTERS).filter((id) => (COUNTERS[id]?.[role]?.length ?? 0) > 0);
}
