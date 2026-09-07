import type { FaceitMatchFaction, FaceitMatchResponse, FaceitMatchRosterEntry } from '../src/main/services/faceit-client'

/**
 * Fixtures modeled on the verified `GET /data/v4/matches/{match_id}` response
 * (see progress/research_faceit-live-match_faceit-api.md). The roster key is
 * `roster` in this endpoint — not `players` as in the history endpoint.
 * `results` exists in the real payload; the client type does not consume it.
 */
type FaceitMatchFixture = FaceitMatchResponse & {
  results?: { winner: 'faction1' | 'faction2'; score: { faction1: number; faction2: number } }
}

export const FACEIT_MATCH_ID = '1-e0112644-9e22-4c5e-a704-e5c78985df5d'

/** Steam64 of the third faction2 player (used as `mySteamId` in team tests). */
export const MY_STEAM_ID = '76561198000000203'

function rosterEntry(faction: 1 | 2, index: number): FaceitMatchRosterEntry {
  return {
    player_id: `p${faction}-0000000${index}-0000-0000-0000-000000000000`,
    nickname: `player_f${faction}_${index}`,
    avatar: `https://assets.faceit.com/avatars/f${faction}-${index}.jpg`,
    skill_level: faction === 1 ? 10 : 7,
    game_player_id: `76561198000000${faction}0${index}`,
    game_player_name: `ingame_f${faction}_${index}`
  }
}

function faction(no: 1 | 2, size = 5): FaceitMatchFaction {
  return {
    nickname: no === 1 ? 'team_FaritoXx' : 'team_Rival',
    roster: Array.from({ length: size }, (_, i) => rosterEntry(no, i + 1))
  }
}

/** Finished 5v5 match with a picked map and a winner. */
export const finishedMatch: FaceitMatchFixture = {
  match_id: FACEIT_MATCH_ID,
  status: 'FINISHED',
  teams: { faction1: faction(1), faction2: faction(2) },
  voting: { map: { pick: ['de_inferno'] } },
  results: { winner: 'faction1', score: { faction1: 13, faction2: 9 } },
  faceit_url: `https://www.faceit.com/{lang}/cs2/room/${FACEIT_MATCH_ID}`
}

/** Same lobby with `mySteamId` (MY_STEAM_ID) placed in faction2's roster. */
export const finishedMatchWithMe: FaceitMatchFixture = {
  ...finishedMatch,
  teams: {
    faction1: faction(1),
    faction2: {
      ...faction(2),
      roster: faction(2).roster!.map((e, i) => (i === 2 ? { ...e, game_player_id: MY_STEAM_ID } : e))
    }
  }
}

/** Veto in progress: no `voting` key yet. */
export const votingMatch: FaceitMatchFixture = {
  match_id: FACEIT_MATCH_ID,
  status: 'VOTING',
  teams: { faction1: faction(1), faction2: faction(2) },
  faceit_url: `https://www.faceit.com/{lang}/cs2/room/${FACEIT_MATCH_ID}`
}

/** Match accepted, veto not started. */
export const readyMatch: FaceitMatchFixture = {
  ...votingMatch,
  status: 'READY'
}

/** Map picked, game running. */
export const ongoingMatch: FaceitMatchFixture = {
  match_id: FACEIT_MATCH_ID,
  status: 'ONGOING',
  teams: { faction1: faction(1), faction2: faction(2) },
  voting: { map: { pick: ['de_inferno'] } },
  faceit_url: `https://www.faceit.com/{lang}/cs2/room/${FACEIT_MATCH_ID}`
}

/** Partial lobby: faction2 has only 3 roster entries (8 players total). */
export const eightPlayerMatch: FaceitMatchFixture = {
  match_id: FACEIT_MATCH_ID,
  status: 'ONGOING',
  teams: { faction1: faction(1), faction2: faction(2, 3) },
  voting: { map: { pick: ['de_inferno'] } },
  faceit_url: `https://www.faceit.com/{lang}/cs2/room/${FACEIT_MATCH_ID}`
}
