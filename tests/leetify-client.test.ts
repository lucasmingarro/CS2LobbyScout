import { describe, expect, it, vi } from 'vitest'
import { RequestManager } from '../src/main/services/request-manager'
import { MemoryCache } from '../src/main/services/cache'
import { LeetifyClient, toImportedMatch, toValveInfo, type LeetifyProfile } from '../src/main/services/leetify-client'

/** Trimmed copy of a real /v3/profile response (2026-09-05). */
const PROFILE: LeetifyProfile = {
  privacy_mode: 'public',
  winrate: 0.3929,
  total_matches: 348,
  first_match_date: '2024-05-12T22:22:58.000Z',
  name: 'blinky',
  bans: [],
  steam64_id: '76561198973228659',
  ranks: {
    leetify: -3.87,
    premier: 8654,
    faceit: null,
    faceit_elo: null,
    wingman: null,
    competitive: [
      { map_name: 'de_nuke', rank: 6 },
      { map_name: 'de_dust2', rank: 3 },
      { map_name: 'cs_office', rank: 0 }
    ]
  },
  rating: { aim: 29.4598, positioning: 44.433, utility: 54.0863, clutch: 0.078, opening: -0.0109 },
  stats: { accuracy_head: 10.9728, preaim: 12.4879, reaction_time_ms: 677.622, spray_accuracy: 32.3008, accuracy_enemy_spotted: 31.3106 },
  recent_matches: [
    { id: 'm1', finished_at: '2026-09-01T00:58:27.000Z', data_source: 'matchmaking', outcome: 'loss', rank: 8654, rank_type: 11, map_name: 'de_dust2', leetify_rating: -0.0746, score: [8, 13] },
    { id: 'm2', finished_at: '2026-08-31T18:13:48.000Z', data_source: 'matchmaking', outcome: 'tie', rank: 8866, rank_type: 11, map_name: 'de_dust2', leetify_rating: -0.0259, score: [15, 15] },
    { id: 'm3', finished_at: '2026-08-21T16:30:40.000Z', data_source: 'matchmaking', outcome: 'loss', rank: 3, rank_type: 12, map_name: 'de_mirage', leetify_rating: -0.0591, score: [4, 13] },
    { id: 'm4', finished_at: '2026-08-18T22:43:12.000Z', data_source: 'matchmaking', outcome: 'win', rank: 9404, rank_type: 11, map_name: 'de_dust2', leetify_rating: -0.0957, score: [13, 6] }
  ]
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })

describe('toValveInfo', () => {
  it('maps the public profile into ValveInfo', () => {
    const v = toValveInfo(PROFILE, '76561198973228659')
    expect(v.premierRating).toBe(8654)
    expect(v.leetifyRating).toBeCloseTo(-3.87)
    expect(v.totalMatches).toBe(348)
    expect(v.winRate).toBeCloseTo(39.3)
    expect(v.competitiveRanks).toEqual({ de_nuke: 6, de_dust2: 3, cs_office: 0 })
    expect(v.preaim).toBeCloseTo(12.4879)
    expect(v.reactionTimeMs).toBeCloseTo(677.622)
    expect(v.headshotAccuracy).toBeCloseTo(10.9728)
    expect(v.ratings?.aim).toBeCloseTo(29.4598)
    expect(v.recent).toMatchObject({ matches: 4, wins: 1, losses: 2, ties: 1, premierNow: 8654, premierThen: 9404 })
    expect(v.recent?.avgLeetifyRating).toBeCloseTo(-6.38, 1)
    expect(v.bans).toBeUndefined()
    expect(v.profileUrl).toContain('76561198973228659')
  })
})

describe('LeetifyClient', () => {
  it('fetches and caches a profile, maps 404 to not_found', async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.includes('76561198973228659') ? json(PROFILE) : json({ message: 'not found' }, 404)))
    const client = new LeetifyClient(new RequestManager({ fetchImpl: fetchImpl as unknown as typeof fetch, retries: 0 }), new MemoryCache())
    const r = await client.profile('76561198973228659')
    expect(r.status).toBe('ok')
    expect(r.info?.premierRating).toBe(8654)
    await client.profile('76561198973228659')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect((await client.profile('76561198000000000')).status).toBe('not_found')
  })

  it('treats private profiles as ok without stats', async () => {
    const fetchImpl = vi.fn(async () => json({ ...PROFILE, privacy_mode: 'private', stats: undefined, ranks: undefined }))
    const client = new LeetifyClient(new RequestManager({ fetchImpl: fetchImpl as unknown as typeof fetch }), new MemoryCache())
    const r = await client.profile('1')
    expect(r.status).toBe('ok')
    expect(r.info?.premierRating).toBeUndefined()
  })

  it('reports unavailable on server errors', async () => {
    const fetchImpl = vi.fn(async () => json({}, 500))
    const client = new LeetifyClient(new RequestManager({ fetchImpl: fetchImpl as unknown as typeof fetch, retries: 0 }), new MemoryCache())
    expect((await client.profile('1')).status).toBe('unavailable')
  })
})

describe('toImportedMatch', () => {
  it('assigns teams relative to me and reads stats defensively', () => {
    const m = toImportedMatch(
      {
        id: 'x',
        finished_at: '2026-09-05T18:40:00.000Z',
        map_name: 'cs_office',
        rank_type: 12,
        team_scores: [
          { team_number: 2, score: 13 },
          { team_number: 3, score: 9 }
        ],
        stats: [
          { steam64_id: '76561198973228659', name: 'blinky', initial_team_number: 3, total_kills: 16, total_deaths: 15, total_assists: 4, dpr: 70.2, total_hs_kills: 8, rank: 8654 },
          { steam64_id: '76561198000000001', name: 'Ramiirez', initial_team_number: 2, total_kills: 21, total_deaths: 14, total_assists: 5, dpr: 88.1, total_hs_kills: 11, rank: 9000 },
          { steam64_id: 'bot', name: 'Bot', initial_team_number: 2 }
        ]
      },
      'x',
      '76561198973228659'
    )!
    expect(m.players).toHaveLength(2)
    expect(m.map).toBe('cs_office')
    expect(m.mode).toBe('competitive')
    expect(m.players.find((p) => p.name === 'blinky')?.team).toBe('mine')
    expect(m.players.find((p) => p.name === 'Ramiirez')).toMatchObject({ team: 'enemy', stats: { kills: 21, deaths: 14, assists: 5, adr: 88.1, headshotPercentage: 52, premierRating: 9000 } })
    expect(m.myScore).toBe(9)
    expect(m.theirScore).toBe(13)
    expect(m.result).toBe('loss')
  })

  it('returns undefined without usable players', () => {
    expect(toImportedMatch({ stats: [] }, 'x', undefined)).toBeUndefined()
  })
})
