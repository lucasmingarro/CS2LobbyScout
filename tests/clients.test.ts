import { describe, expect, it, vi } from 'vitest'
import { RequestManager } from '../src/main/services/request-manager'
import { MemoryCache } from '../src/main/services/cache'
import { SteamClient } from '../src/main/services/steam-client'
import { FaceitClient } from '../src/main/services/faceit-client'

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })

describe('SteamClient', () => {
  const summaries = {
    response: {
      players: [
        { steamid: '1', personaname: 'aim.exe', profileurl: 'https://steamcommunity.com/id/aim', avatarfull: 'https://a/1.jpg', communityvisibilitystate: 3, timecreated: 1700000000 },
        { steamid: '2', personaname: 'private guy', profileurl: 'https://steamcommunity.com/profiles/2', communityvisibilitystate: 1 }
      ]
    }
  }
  const bans = {
    players: [
      { SteamId: '1', CommunityBanned: false, VACBanned: false, NumberOfVACBans: 0, DaysSinceLastBan: 0, NumberOfGameBans: 0, EconomyBan: 'none' },
      { SteamId: '2', CommunityBanned: false, VACBanned: true, NumberOfVACBans: 1, DaysSinceLastBan: 120, NumberOfGameBans: 0, EconomyBan: 'none' }
    ]
  }
  const games = { response: { game_count: 1, games: [{ appid: 730, playtime_forever: 12840 }] } }

  function makeFetch(): ReturnType<typeof vi.fn> {
    return vi.fn(async (url: string) => {
      if (url.includes('GetPlayerSummaries')) return json(summaries)
      if (url.includes('GetPlayerBans')) return json(bans)
      if (url.includes('GetOwnedGames')) return json(games)
      return json({}, 404)
    })
  }

  it('enriches a lobby in one batched call per endpoint and caches', async () => {
    const fetchImpl = makeFetch()
    const cache = new MemoryCache()
    const client = new SteamClient(new RequestManager({ fetchImpl: fetchImpl as unknown as typeof fetch }), cache, () => 'KEY')

    const res = await client.lookup(['1', '2'])
    expect(fetchImpl).toHaveBeenCalledTimes(3) // summaries + bans + owned games for the one public profile
    const p1 = res.get('1')!
    expect(p1.summaryOk && p1.bansOk).toBe(true)
    expect(p1.info).toMatchObject({ personaName: 'aim.exe', profilePrivate: false, vacBans: 0, gameBans: 0, cs2Hours: 214 })
    expect(p1.info.accountCreatedAt).toBe(new Date(1700000000 * 1000).toISOString())
    const p2 = res.get('2')!
    expect(p2.info).toMatchObject({ profilePrivate: true, vacBans: 1, daysSinceLastBan: 120 })
    expect(p2.info.cs2Hours).toBeUndefined()

    await client.lookup(['1', '2'])
    expect(fetchImpl).toHaveBeenCalledTimes(3) // all served from cache

    await client.lookup(['1'], { bypassCache: true })
    expect(fetchImpl).toHaveBeenCalledTimes(6)
  })

  it('does not call the API without a key', async () => {
    const fetchImpl = makeFetch()
    const client = new SteamClient(new RequestManager({ fetchImpl: fetchImpl as unknown as typeof fetch }), new MemoryCache(), () => undefined)
    const res = await client.lookup(['1'])
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(res.get('1')).toMatchObject({ summaryOk: false, bansOk: false })
    expect(client.hasKey()).toBe(false)
  })

  it('tolerates a failing endpoint', async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.includes('GetPlayerBans') ? json({}, 500) : json(summaries)))
    const client = new SteamClient(
      new RequestManager({ fetchImpl: fetchImpl as unknown as typeof fetch, retries: 0 }),
      new MemoryCache(),
      () => 'KEY'
    )
    const res = await client.lookup(['1'], { includePlaytime: false })
    expect(res.get('1')).toMatchObject({ summaryOk: true, bansOk: false })
  })

  it('fetchBans always bypasses the cache', async () => {
    const fetchImpl = makeFetch()
    const client = new SteamClient(new RequestManager({ fetchImpl: fetchImpl as unknown as typeof fetch }), new MemoryCache(), () => 'KEY')
    await client.fetchBans(['1', '2'])
    await client.fetchBans(['1', '2'])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const b = await client.fetchBans(['2'])
    expect(b.get('2')).toEqual({ vacBans: 1, gameBans: 0, daysSinceLastBan: 120 })
  })
})

describe('FaceitClient', () => {
  const player = {
    player_id: 'f-1',
    nickname: 'aimexe',
    avatar: 'https://f/1.jpg',
    country: 'ar',
    faceit_url: 'https://www.faceit.com/{lang}/players/aimexe',
    activated_at: '2026-04-01T00:00:00Z',
    games: { cs2: { skill_level: 4, faceit_elo: 1180, game_player_id: '76561197961500295' } }
  }
  const stats = {
    lifetime: { Matches: '91', 'Win Rate %': '68', 'Average K/D Ratio': '1.82', 'Average Headshots %': '74', ADR: '116.3', 'Recent Results': ['1', '1', '0', '1', '1'] }
  }
  const recent = {
    items: Array.from({ length: 20 }, (_, i) => ({ stats: { 'K/D Ratio': i % 2 ? '2.1' : '1.9', ADR: '120', 'Headshots %': '70', Result: i < 14 ? '1' : '0', Kills: '25' } }))
  }

  function makeFetch(notFound = false): ReturnType<typeof vi.fn> {
    return vi.fn(async (url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer FKEY')
      if (url.includes('/players?game=cs2&game_player_id=')) return notFound ? json({ errors: [{ message: 'not found' }] }, 404) : json(player)
      if (url.includes('/search/players?nickname=')) {
        const nick = decodeURIComponent(url.split('nickname=')[1].split('&')[0]).toLowerCase()
        if (nick === 'aimexe' && !notFound) return json({ items: [{ player_id: 'f-1', nickname: 'aimexe' }, { player_id: 'f-9', nickname: 'aimexe2' }] })
        if (nick === 'dupe') return json({ items: [{ player_id: 'a', nickname: 'Dupe' }, { player_id: 'b', nickname: 'dupe' }] })
        return json({ items: [] })
      }
      if (url.includes('/players?nickname=')) {
        const nick = decodeURIComponent(url.split('nickname=')[1])
        // exact endpoint is case sensitive
        return nick === 'aimexe' && !notFound ? json(player) : json({ errors: [{ message: 'not found' }] }, 404)
      }
      if (url.endsWith('/players/f-1')) return json(player)
      if (url.endsWith('/players/f-1/stats/cs2')) return json(stats)
      if (url.includes('/players/f-1/games/cs2/stats')) return json(recent)
      return json({}, 404)
    })
  }

  it('maps steam id -> profile -> lifetime + recent stats', async () => {
    const fetchImpl = makeFetch()
    const client = new FaceitClient(new RequestManager({ fetchImpl: fetchImpl as unknown as typeof fetch }), new MemoryCache(), () => 'FKEY')
    const r = await client.lookup('1')
    expect(r.status).toBe('ok')
    expect(r.info).toMatchObject({
      playerId: 'f-1',
      nickname: 'aimexe',
      level: 4,
      elo: 1180,
      matches: 91,
      winRate: 68,
      kd: 1.82,
      headshotPercentage: 74,
      adr: 116.3,
      profileUrl: 'https://www.faceit.com/en/players/aimexe',
      activatedAt: '2026-04-01T00:00:00Z'
    })
    expect(r.info!.recent).toMatchObject({ matches: 20, adr: 120, headshotPercentage: 70, winRate: 70 })
    expect(r.info!.recent!.kd).toBeCloseTo(2.0, 5)
    expect(fetchImpl).toHaveBeenCalledTimes(3)

    await client.lookup('1')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('resolves a Steam64 from an exact FACEIT nickname', async () => {
    const fetchImpl = makeFetch()
    const client = new FaceitClient(new RequestManager({ fetchImpl: fetchImpl as unknown as typeof fetch }), new MemoryCache(), () => 'FKEY')
    const r = await client.lookupByNickname('AimExe')
    expect(r.status).toBe('ok')
    expect(r.steamId).toBe('76561197961500295')
    expect(r.info).toMatchObject({ nickname: 'aimexe', level: 4, kd: 1.82 })

    const miss = await client.lookupByNickname('someone else')
    expect(miss.status).toBe('not_found')
    expect(miss.steamId).toBeUndefined()
    // cached negative lookup (exact + search endpoints, once each)
    await client.lookupByNickname('someone else')
    expect(fetchImpl.mock.calls.filter((c) => String(c[0]).includes('someone')).length).toBe(2)
  })

  it('falls back to the case-insensitive search when the exact endpoint misses', async () => {
    const fetchImpl = makeFetch()
    const client = new FaceitClient(new RequestManager({ fetchImpl: fetchImpl as unknown as typeof fetch }), new MemoryCache(), () => 'FKEY')
    const r = await client.lookupByNickname('AIMEXE')
    expect(r.status).toBe('ok')
    expect(r.steamId).toBe('76561197961500295')
    expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes('/search/players'))).toBe(true)
    expect(fetchImpl.mock.calls.some((c) => String(c[0]).endsWith('/players/f-1'))).toBe(true)

    // ambiguous: two accounts differing only by case -> not resolved
    expect((await client.lookupByNickname('dupe')).status).toBe('not_found')
  })

  it('returns not_found (and caches it) when no FACEIT account exists', async () => {
    const fetchImpl = makeFetch(true)
    const client = new FaceitClient(new RequestManager({ fetchImpl: fetchImpl as unknown as typeof fetch }), new MemoryCache(), () => 'FKEY')
    expect((await client.lookup('1')).status).toBe('not_found')
    expect((await client.lookup('1')).status).toBe('not_found')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('returns unavailable on server errors or without a key', async () => {
    const failing = vi.fn(async () => json({}, 500))
    const client = new FaceitClient(new RequestManager({ fetchImpl: failing as unknown as typeof fetch, retries: 0 }), new MemoryCache(), () => 'FKEY')
    expect((await client.lookup('1')).status).toBe('unavailable')
    const noKey = new FaceitClient(new RequestManager({ fetchImpl: failing as unknown as typeof fetch }), new MemoryCache(), () => undefined)
    expect((await noKey.lookup('1')).status).toBe('unavailable')
  })

  it('still returns the profile when the stats endpoint fails', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('game_player_id')) return json(player)
      return json({}, 500)
    })
    const client = new FaceitClient(new RequestManager({ fetchImpl: fetchImpl as unknown as typeof fetch, retries: 0 }), new MemoryCache(), () => 'FKEY')
    const r = await client.lookup('1')
    expect(r.status).toBe('ok')
    expect(r.info).toMatchObject({ level: 4, elo: 1180 })
    expect(r.info!.kd).toBeUndefined()
  })
})
