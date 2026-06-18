import type { Region, Role, RunePage } from '@lolperform/shared';
import type { NormMatch, NormParticipant } from '../riot/types.js';

const RUNES: RunePage = {
  keystone: 8005,
  primaryStyle: 8000,
  subStyle: 8400,
  primary: [8005, 9111, 9105, 8014],
  secondary: [8473, 8453],
  shards: [5005, 5008, 5003],
};

function p(
  championKey: string,
  role: Role,
  teamId: 100 | 200,
  win: boolean,
  items: number[] = [3006, 6672, 3094],
): NormParticipant {
  return { championKey, role, teamId, win, items, runes: RUNES };
}

/**
 * Build N bot-lane-focused matches. Team 100 always runs Caitlyn (51) + Thresh
 * (412) bot; team 200 runs Jhin (202) + Pyke (555) bot. `caitWins` of the N go
 * to team 100. Other lanes are filled with stable placeholder champions.
 */
export function botLaneMatches(n: number, caitWins: number, region: Region = 'na1'): NormMatch[] {
  const matches: NormMatch[] = [];
  for (let i = 0; i < n; i++) {
    const blueWin = i < caitWins;
    matches.push({
      matchId: `${region}_${i}`,
      patch: '15.13',
      region,
      tier: 'CHALLENGER',
      bans: [157, 238],
      participants: [
        p('1', 'TOP', 100, blueWin),
        p('2', 'JUNGLE', 100, blueWin),
        p('3', 'MIDDLE', 100, blueWin),
        p('51', 'BOTTOM', 100, blueWin),
        p('412', 'UTILITY', 100, blueWin),
        p('4', 'TOP', 200, !blueWin),
        p('5', 'JUNGLE', 200, !blueWin),
        p('6', 'MIDDLE', 200, !blueWin),
        p('202', 'BOTTOM', 200, !blueWin),
        p('555', 'UTILITY', 200, !blueWin),
      ],
    });
  }
  return matches;
}
