import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { openDatabase } from '../src/main/db/database'
import { Repositories } from '../src/main/db/repositories'
import { RequestManager } from '../src/main/services/request-manager'
import { MemoryCache } from '../src/main/services/cache'
import { FaceitClient, toFaceitLobby } from '../src/main/services/faceit-client'
import { ScoutService } from '../src/main/services/scout-service'
import type { SteamClient } from '../src/main/services/steam-client'
import type { LeetifyClient } from '../src/main/services/leetify-client'
import type { ConfigStore } from '../src/main/config'
import {
  eightPlayerMatch,
  FACEIT_MATCH_ID,
  finishedMatch,
  finishedMatchWithMe,
  MY_STEAM_ID,
  ongoingMatch,
  readyMatch,
  votingMatch
} from './fixtures-faceit-match'

describe('toFaceitLobby', () => {
  // R3: 5v5 match becomes a 10-player lobby with verified identities
  it('maps both rosters into 10 players with Steam64, player_id, nickname and avatar', () => {
    const { players, context } = toFaceitLobby(finishedMatch)
    expect(players).toHaveLength(10)
    for (const p of players) {
      expect(p.steamId).toMatch(/^7656119\d{10}$/)
      expect(p.playerId).toBeTruthy()
      expect(p.nickname).toBeTruthy()
      expect(p.avatarUrl).toMatch(/^https:\/\//)
    }
    const first = players.find((p) => p.playerId === 'p1-00000001-0000-0000-0000-000000000000')!
    expect(first).toMatchObject({
      steamId: '76561198000000101',
      nickname: 'player_f1_1',
      faction: 'faction1',
      level: 10
    })
    expect(context.matchId).toBe(FACEIT_MATCH_ID)
    expect(context.faceitUrl).toBe(`https://www.faceit.com/en/cs2/room/${FACEIT_MATCH_ID}`)
  })

  // R4: team separation when mySteamId is in faction2
  it('assigns mine/enemy against mySteamId and flags the local player', () => {
    const { players } = toFaceitLobby(finishedMatchWithMe, MY_STEAM_ID)
    const faction1 = players.filter((p) => p.faction === 'faction1')
    const faction2 = players.filter((p) => p.faction === 'faction2')
    expect(faction1.every((p) => p.team === 'enemy')).toBe(true)
    expect(faction2.every((p) => p.team === 'mine')).toBe(true)
    const locals = players.filter((p) => p.isLocal)
    expect(locals).toHaveLength(1)
    expect(locals[0].steamId).toBe(MY_STEAM_ID)
  })

  // R5: neutral factions when the user is not in the match
  it('keeps everyone unknown, exposes faction nicknames and marks no local when mySteamId is absent', () => {
    const { players, context } = toFaceitLobby(finishedMatch, '76561198999999999')
    expect(players).toHaveLength(10)
    expect(players.every((p) => p.team === 'unknown')).toBe(true)
    expect(players.every((p) => !p.isLocal)).toBe(true)
    expect(players.filter((p) => p.faction === 'faction1')).toHaveLength(5)
    expect(players.filter((p) => p.faction === 'faction2')).toHaveLength(5)
    expect(context.factionNames).toEqual({ faction1: 'team_FaritoXx', faction2: 'team_Rival' })
  })

  it('behaves the same without any mySteamId configured', () => {
    const { players } = toFaceitLobby(finishedMatch)
    expect(players.every((p) => p.team === 'unknown' && !p.isLocal)).toBe(true)
  })

  // R7: status without map while veto runs
  it('exposes the status and no map while the veto is in progress', () => {
    const { context } = toFaceitLobby(votingMatch)
    expect(context.status).toBe('VOTING')
    expect(context.mapPick).toBeUndefined()
    expect(toFaceitLobby(readyMatch).context.status).toBe('READY')
  })

  // R7: map pick once the veto is done
  it('exposes the picked map on an ongoing match', () => {
    const { context } = toFaceitLobby(ongoingMatch)
    expect(context.status).toBe('ONGOING')
    expect(context.mapPick).toBe('de_inferno')
  })

  // R7: finished matches load equally
  it('loads a finished match like any other', () => {
    const { players, context } = toFaceitLobby(finishedMatch)
    expect(players).toHaveLength(10)
    expect(context.status).toBe('FINISHED')
    expect(context.mapPick).toBe('de_inferno')
  })

  // R12: partial rosters load
  it('builds an 8-player lobby when a faction has only 3 roster entries', () => {
    const { players } = toFaceitLobby(eightPlayerMatch)
    expect(players).toHaveLength(8)
    expect(players.filter((p) => p.faction === 'faction1')).toHaveLength(5)
    expect(players.filter((p) => p.faction === 'faction2')).toHaveLength(3)
  })
})

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })

/** FACEIT API mock for the whole match-load flow (no identity-resolution routes). */
function makeMatchFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/matches/')) return json(finishedMatchWithMe)
    if (u.includes('/games/cs2/stats')) return json({ items: [] })
    if (u.endsWith('/stats/cs2')) return json({ lifetime: { Matches: '500', 'Win Rate %': '52', 'Average K/D Ratio': '1.10', 'Average Headshots %': '48' } })
    const profile = u.match(/\/players\/([^/?]+)$/)
    if (profile) {
      const playerId = decodeURIComponent(profile[1])
      return json({ player_id: playerId, nickname: `nick_${playerId.slice(0, 2)}`, games: { cs2: { skill_level: 8, faceit_elo: 1500 } } })
    }
    return json({}, 404)
  })
}

function makeService(fetchImpl: ReturnType<typeof vi.fn>, opts: { faceitKey?: string; mySteamId?: string } = {}): {
  scout: ScoutService
  repos: Repositories
  db: ReturnType<typeof openDatabase>
} {
  const db = openDatabase(':memory:')
  const repos = new Repositories(db)
  const rm = new RequestManager({ fetchImpl: fetchImpl as unknown as typeof fetch, retries: 0 })
  const faceit = new FaceitClient(rm, new MemoryCache(), () => opts.faceitKey)
  const steam = { hasKey: () => false } as unknown as SteamClient
  const leetify = { profile: async () => ({ status: 'not_found' as const }) } as unknown as LeetifyClient
  const config = { getSettings: () => ({ ...DEFAULT_SETTINGS, mySteamId: opts.mySteamId ?? '' }) } as unknown as ConfigStore
  const scout = new ScoutService(repos, steam, faceit, leetify, config, () => {})
  return { scout, repos, db }
}

describe('ScoutService.loadFaceitMatch', () => {
  // R3 + R6 + R8: happy path with verified identities and no identity resolution
  it('builds, persists and enriches a faceit_match session by player_id only', async () => {
    const fetchImpl = makeMatchFetch()
    const { scout, repos, db } = makeService(fetchImpl, { faceitKey: 'FKEY', mySteamId: MY_STEAM_ID })

    const session = await scout.loadFaceitMatch(FACEIT_MATCH_ID)
    expect(session.source).toBe('faceit_match')
    expect(session.players).toHaveLength(10)
    expect(session.players.every((p) => p.identity === 'faceit_match')).toBe(true)
    expect(session.faceitMatch).toMatchObject({ matchId: FACEIT_MATCH_ID, status: 'FINISHED', mapPick: 'de_inferno' })
    // R4 through the service: teams separated against mySteamId
    expect(session.players.filter((p) => p.team === 'mine')).toHaveLength(5)
    expect(session.players.filter((p) => p.team === 'enemy')).toHaveLength(5)
    expect(session.players.filter((p) => p.isLocal).map((p) => p.steamId)).toEqual([MY_STEAM_ID])

    // Background enrichment finishes via lookupById.
    await vi.waitFor(() => {
      const s = scout.currentSession()!
      expect(s.players.every((p) => p.sources.faceit === 'ok')).toBe(true)
    })
    const enriched = scout.currentSession()!.players[0]
    expect(enriched.faceit).toMatchObject({ elo: 1500, matches: 500, kd: 1.1 })

    // R6: no identity-resolution request was made.
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('nickname=') || u.includes('game_player_id=') || u.includes('/search/players'))).toBe(false)

    // R8: session row with source faceit_match and one encounter per player.
    const rows = db.prepare(`SELECT source FROM match_sessions`).all() as Array<{ source: string }>
    expect(rows).toEqual([{ source: 'faceit_match' }])
    const mine = repos.fullHistory(MY_STEAM_ID)!
    expect(mine.encounters).toHaveLength(1)
    expect(mine.encounters[0].team).toBe('mine')
  })

  // R9: no key -> actionable error, no network
  it('fails without a FACEIT key before any request', async () => {
    const fetchImpl = makeMatchFetch()
    const { scout, repos } = makeService(fetchImpl, { faceitKey: undefined })
    await expect(scout.loadFaceitMatch(FACEIT_MATCH_ID)).rejects.toThrow(/FACEIT API key.*Settings/)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(repos.counts().sessions).toBe(0)
  })

  // R10: 404 -> match not found, no session
  it('fails with a not-found message on 404', async () => {
    const fetchImpl = vi.fn(async () => json({ errors: [{ message: 'not found' }] }, 404))
    const { scout, repos } = makeService(fetchImpl, { faceitKey: 'FKEY' })
    await expect(scout.loadFaceitMatch(FACEIT_MATCH_ID)).rejects.toThrow(/not found on FACEIT/)
    expect(repos.counts().sessions).toBe(0)
  })

  // R11: API failure -> surfaced, no session
  it('surfaces an API failure instead of an empty lobby', async () => {
    const fetchImpl = vi.fn(async () => json({}, 500))
    const { scout, repos } = makeService(fetchImpl, { faceitKey: 'FKEY' })
    await expect(scout.loadFaceitMatch(FACEIT_MATCH_ID)).rejects.toThrow(/could not be reached/)
    expect(repos.counts().sessions).toBe(0)
  })
})
