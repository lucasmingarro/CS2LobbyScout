import type { FaceitInfo } from '@shared/types'
import { ApiError, type RequestManager } from './request-manager'
import { TTL, type CacheStore } from './cache'
import { logger } from '../logger'

const API = 'https://open.faceit.com/data/v4'
const GAME = 'cs2'
const RECENT_LIMIT = 20

interface FaceitPlayer {
  player_id: string
  nickname: string
  avatar?: string
  country?: string
  faceit_url?: string
  activated_at?: string
  games?: Record<string, { skill_level?: number; faceit_elo?: number; game_player_id?: string }>
}

interface FaceitLifetimeStats {
  lifetime?: Record<string, string | string[]>
}

interface FaceitRecentStats {
  items?: Array<{ stats: Record<string, string> }>
}

interface FaceitSearchResult {
  items?: Array<{ player_id: string; nickname: string; games?: Array<{ name: string }> }>
}

type CachedProfile = { notFound: true } | { notFound: false; player: FaceitPlayer }

export type FaceitLookupStatus = 'ok' | 'not_found' | 'unavailable'

export interface FaceitLookupResult {
  status: FaceitLookupStatus
  info?: FaceitInfo
}

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined
  const n = typeof v === 'number' ? v : Number(String(v).replace('%', ''))
  return Number.isFinite(n) ? n : undefined
}

function pick(obj: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  if (!obj) return undefined
  for (const k of keys) {
    const v = num(obj[k])
    if (v !== undefined) return v
  }
  return undefined
}

export class FaceitClient {
  constructor(
    private rm: RequestManager,
    private cache: CacheStore,
    private getKey: () => string | undefined
  ) {}

  hasKey(): boolean {
    return !!this.getKey()
  }

  private headers(key: string): Record<string, string> {
    return { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  }

  /** Look up by Steam64 (the reliable path when `status` printed ids). */
  async lookup(steamId: string, options: { bypassCache?: boolean } = {}): Promise<FaceitLookupResult> {
    const key = this.getKey()
    if (!key) return { status: 'unavailable' }
    let profile: CachedProfile | undefined
    try {
      profile = await this.profile(`faceit:profile:${steamId}`, `${API}/players?game=${GAME}&game_player_id=${encodeURIComponent(steamId)}`, key, options.bypassCache)
    } catch (err) {
      logger.warn('faceit.profile_failed', { steamId, error: (err as Error).message })
      return { status: 'unavailable' }
    }
    if (profile.notFound) return { status: 'not_found' }
    return { status: 'ok', info: await this.enrich(profile.player, key, options.bypassCache) }
  }

  /**
   * Look up by exact FACEIT nickname. Used on official Valve servers, where
   * `status` hides Steam ids: when a player uses the same nickname on FACEIT
   * we get their profile *and* their Steam64 (games.cs2.game_player_id).
   * The match is unverified and the UI must say so.
   */
  async lookupByNickname(nickname: string, options: { bypassCache?: boolean } = {}): Promise<FaceitLookupResult & { steamId?: string }> {
    const key = this.getKey()
    if (!key) return { status: 'unavailable' }
    const nick = nickname.trim()
    if (!nick || nick.length > 64) return { status: 'not_found' }
    let profile: CachedProfile | undefined
    try {
      profile = await this.profile(`faceit:nick:${nick.toLowerCase()}`, `${API}/players?nickname=${encodeURIComponent(nick)}`, key, options.bypassCache)
    } catch (err) {
      logger.warn('faceit.nick_failed', { nickname: nick, error: (err as Error).message })
      return { status: 'unavailable' }
    }
    let p: FaceitPlayer | undefined = profile.notFound ? undefined : profile.player
    if (p && p.nickname.toLowerCase() !== nick.toLowerCase()) p = undefined
    if (!p) {
      // The exact endpoint is case sensitive; fall back to the search endpoint and
      // accept a single case-insensitive exact match.
      try {
        p = await this.searchExact(nick, key, options.bypassCache)
      } catch (err) {
        logger.warn('faceit.search_failed', { nickname: nick, error: (err as Error).message })
        return { status: 'unavailable' }
      }
    }
    if (!p) return { status: 'not_found' }
    const steamId = p.games?.[GAME]?.game_player_id
    if (!steamId || !/^7656119\d{10}$/.test(steamId)) return { status: 'not_found' }
    return { status: 'ok', steamId, info: await this.enrich(p, key, options.bypassCache) }
  }

  /** Search players by nickname and return the unique case-insensitive exact match, if any. */
  private async searchExact(nick: string, key: string, bypass?: boolean): Promise<FaceitPlayer | undefined> {
    const cacheKey = `faceit:search:${nick.toLowerCase()}`
    if (!bypass) {
      const cached = this.cache.get<CachedProfile>(cacheKey)
      if (cached) return cached.notFound ? undefined : cached.player
    }
    const url = `${API}/search/players?nickname=${encodeURIComponent(nick)}&game=${GAME}&offset=0&limit=20`
    let result: FaceitSearchResult
    try {
      result = await this.rm.getJson<FaceitSearchResult>(cacheKey, url, { headers: this.headers(key) })
    } catch (err) {
      if (err instanceof ApiError && (err.kind === 'not_found' || err.kind === 'bad_request')) result = { items: [] }
      else throw err
    }
    const matches = (result.items ?? []).filter((it) => it.nickname.toLowerCase() === nick.toLowerCase())
    if (matches.length !== 1) {
      this.cache.set(cacheKey, { notFound: true } satisfies CachedProfile, TTL.faceitNotFound)
      if (matches.length > 1) logger.debug('faceit.search_ambiguous', { nickname: nick, count: matches.length })
      return undefined
    }
    // The search result lacks game ids; load the full player object.
    const full = await this.profile(`faceit:player:${matches[0].player_id}`, `${API}/players/${matches[0].player_id}`, key, bypass)
    if (full.notFound) {
      this.cache.set(cacheKey, { notFound: true } satisfies CachedProfile, TTL.faceitNotFound)
      return undefined
    }
    this.cache.set(cacheKey, full, TTL.faceitProfile)
    return full.player
  }

  private async enrich(p: FaceitPlayer, key: string, bypassCache?: boolean): Promise<FaceitInfo> {
    const game = p.games?.[GAME]
    const info: FaceitInfo = {
      playerId: p.player_id,
      nickname: p.nickname,
      avatarUrl: p.avatar || undefined,
      country: p.country,
      profileUrl: p.faceit_url ? p.faceit_url.replace('{lang}', 'en') : `https://www.faceit.com/en/players/${p.nickname}`,
      level: game?.skill_level,
      elo: game?.faceit_elo,
      activatedAt: p.activated_at
    }

    const [lifetime, recent] = await Promise.all([
      this.lifetime(p.player_id, key, bypassCache).catch((err) => {
        logger.warn('faceit.stats_failed', { playerId: p.player_id, error: (err as Error).message })
        return undefined
      }),
      this.recent(p.player_id, key, bypassCache).catch((err) => {
        logger.debug('faceit.recent_failed', { playerId: p.player_id, error: (err as Error).message })
        return undefined
      })
    ])

    if (lifetime?.lifetime) {
      const lt = lifetime.lifetime as Record<string, unknown>
      info.matches = pick(lt, 'Matches', 'Total Matches')
      info.winRate = pick(lt, 'Win Rate %', 'Win Rate')
      info.kd = pick(lt, 'Average K/D Ratio', 'K/D Ratio')
      info.headshotPercentage = pick(lt, 'Average Headshots %', 'Headshots %', 'Total Headshots %')
      info.adr = pick(lt, 'ADR', 'Average Damage per Round', 'Average ADR')
    }

    if (recent?.items && recent.items.length > 0) {
      const items = recent.items
      const avg = (...keys: string[]): number | undefined => {
        const vals = items.map((it) => pick(it.stats as Record<string, unknown>, ...keys)).filter((v): v is number => v !== undefined)
        if (vals.length === 0) return undefined
        return vals.reduce((a, b) => a + b, 0) / vals.length
      }
      const wins = items.map((it) => num(it.stats['Result'])).filter((v): v is number => v !== undefined)
      info.recent = {
        matches: items.length,
        kd: avg('K/D Ratio'),
        adr: avg('ADR'),
        headshotPercentage: avg('Headshots %'),
        winRate: wins.length ? (wins.reduce((a, b) => a + b, 0) / wins.length) * 100 : undefined
      }
    }
    return info
  }

  private async profile(cacheKey: string, url: string, key: string, bypass?: boolean): Promise<CachedProfile> {
    if (!bypass) {
      const cached = this.cache.get<CachedProfile>(cacheKey)
      if (cached) return cached
    }
    try {
      const player = await this.rm.getJson<FaceitPlayer>(cacheKey, url, { headers: this.headers(key) })
      const value: CachedProfile = { notFound: false, player }
      this.cache.set(cacheKey, value, TTL.faceitProfile)
      return value
    } catch (err) {
      if (err instanceof ApiError && (err.kind === 'not_found' || err.kind === 'bad_request')) {
        const value: CachedProfile = { notFound: true }
        this.cache.set(cacheKey, value, TTL.faceitNotFound)
        return value
      }
      throw err
    }
  }

  private async lifetime(playerId: string, key: string, bypass?: boolean): Promise<FaceitLifetimeStats> {
    const cacheKey = `faceit:stats:${playerId}`
    if (!bypass) {
      const cached = this.cache.get<FaceitLifetimeStats>(cacheKey)
      if (cached) return cached
    }
    const data = await this.rm.getJson<FaceitLifetimeStats>(cacheKey, `${API}/players/${playerId}/stats/${GAME}`, {
      headers: this.headers(key)
    })
    this.cache.set(cacheKey, data, TTL.faceitStats)
    return data
  }

  private async recent(playerId: string, key: string, bypass?: boolean): Promise<FaceitRecentStats> {
    const cacheKey = `faceit:recent:${playerId}`
    if (!bypass) {
      const cached = this.cache.get<FaceitRecentStats>(cacheKey)
      if (cached) return cached
    }
    const data = await this.rm.getJson<FaceitRecentStats>(
      cacheKey,
      `${API}/players/${playerId}/games/${GAME}/stats?offset=0&limit=${RECENT_LIMIT}`,
      { headers: this.headers(key) }
    )
    // Keep only what we use to keep the cache small.
    const slim: FaceitRecentStats = {
      items: (data.items ?? []).map((it) => ({
        stats: {
          'K/D Ratio': it.stats?.['K/D Ratio'],
          ADR: it.stats?.['ADR'],
          'Headshots %': it.stats?.['Headshots %'],
          Result: it.stats?.['Result']
        }
      }))
    }
    this.cache.set(cacheKey, slim, TTL.faceitStats)
    return slim
  }
}
