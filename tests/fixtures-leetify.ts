/** Trimmed real responses from the Leetify public API (2026-09-05). */

export const ME = '76561198973228659'

/** GET /v3/profile/matches?steam64_id=... (two of ~90 rows). */
export const PROFILE_MATCHES = [
  {
    id: '42ca63fa-fa79-4bd6-967b-56709457aa1d',
    finished_at: '2026-09-05T03:04:39.000Z',
    data_source: 'matchmaking',
    data_source_match_id: 'CSGO-ZXAcM-ModHu-skAKZ-LfDe4-SVddJ',
    map_name: 'de_ancient',
    has_banned_player: false,
    team_scores: [
      { team_number: 2, score: 13 },
      { team_number: 3, score: 11 }
    ],
    stats: [{ steam64_id: ME, name: 'blinky', initial_team_number: 2, rounds_won: 13, rounds_lost: 11 }]
  },
  {
    id: '0275e203-88b8-4746-a3a9-86cab1de2e34',
    finished_at: '2026-08-26T22:54:59.000Z',
    data_source: 'matchmaking_competitive',
    map_name: 'de_inferno',
    team_scores: [
      { team_number: 2, score: 3 },
      { team_number: 3, score: 5 }
    ],
    stats: [{ steam64_id: ME, name: 'blinky', initial_team_number: 2 }]
  }
]

/** GET https://api.leetify.com/api/games/{id} — three of the ten players kept. */
export const MATCH_DETAIL = {
  id: '472abd34-d6b2-4d32-acdc-f5b01b6ee334',
  finishedAt: '2026-09-01T00:58:27.000Z',
  dataSource: 'matchmaking',
  mapName: 'de_dust2',
  isCs2: true,
  hasBannedPlayer: false,
  status: 'ready',
  teamScores: [13, 8],
  details: { gameId: '472abd34-d6b2-4d32-acdc-f5b01b6ee334', tickrate: 64, serverName: 'Valve Counter-Strike 2 argentina Server (srcds1004-eze1.346.39)' },
  matchmakingGameStats: [
    { steam64Id: '76561198286343610', rank: 17193, oldRank: 16969, rankType: 11, rankChanged: true, wins: 103 },
    { steam64Id: ME, rank: 8654, oldRank: 8866, rankType: 11, rankChanged: true, wins: 35 },
    { steam64Id: '76561199593465717', rank: 22805, oldRank: 22928, rankType: 11, rankChanged: true, wins: 52 }
  ],
  parties: [
    { party: 2, steam64Id: '76561198286343610' },
    { party: 0, steam64Id: ME },
    { party: 0, steam64Id: '76561199593465717' }
  ],
  playerStats: [
    {
      steam64Id: '76561198286343610',
      name: 'scz',
      preaim: 9.0172,
      reactionTime: 0.6719,
      accuracyHead: 0.2692,
      initialTeamNumber: 3,
      mvps: 5,
      ctRoundsWon: 9,
      ctRoundsLost: 3,
      tRoundsWon: 4,
      tRoundsLost: 5,
      totalKills: 21,
      totalDeaths: 12,
      totalAssists: 5,
      kdRatio: 1.75,
      hsp: 0.4762,
      dpr: 88.81,
      score: 53,
      leetifyRating: 0.1071
    },
    {
      steam64Id: ME,
      name: 'blinky',
      preaim: 13.1208,
      reactionTime: 0.7188,
      accuracyHead: 0.2273,
      initialTeamNumber: 2,
      mvps: 0,
      ctRoundsWon: 5,
      ctRoundsLost: 4,
      tRoundsWon: 3,
      tRoundsLost: 9,
      totalKills: 6,
      totalDeaths: 14,
      totalAssists: 2,
      kdRatio: 0.43,
      hsp: 0.8333,
      dpr: 37.29,
      score: 16,
      leetifyRating: -0.0746
    },
    {
      steam64Id: '76561199593465717',
      name: 'FaritoXx',
      preaim: 7.9832,
      reactionTime: 0.6094,
      accuracyHead: 0.3077,
      initialTeamNumber: 2,
      mvps: 6,
      ctRoundsWon: 5,
      ctRoundsLost: 4,
      tRoundsWon: 3,
      tRoundsLost: 9,
      totalKills: 29,
      totalDeaths: 16,
      totalAssists: 6,
      kdRatio: 1.81,
      hsp: 0.6897,
      dpr: 141.76,
      score: 67,
      leetifyRating: 0.1163
    }
  ]
}
