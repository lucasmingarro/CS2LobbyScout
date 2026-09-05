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

  async lookup(steamId: string, options: { bypassCache?: boolean } = {}): Promise<FaceitLookupResult> {
    const key = this.getKey()
    if (!key) return { status: 'unavailable' }

    let profile: CachedProfile | undefined
    try {
      profile = await this.profile(steamId, key, options.bypassCache)
    } catch (err) {
      logger.warn('faceit.profile_failed', { steamId, error: (err as Error).message })
      return { status: 'unavailable' }
    }
    if (profile.notFound) return { status: 'not_found' }

    const p = profile.player
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
      this.lifetime(p.player_id, key, options.bypassCache).catch((err) => {
        logger.warn('faceit.stats_failed', { steamId, error: (err as Error).message })
        return undefined
      }),
      this.recent(p.player_id, key, options.bypassCache).catch((err) => {
        logger.debug('faceit.recent_failed', { steamId, error: (err as Error).message })
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

    return { status: 'ok', info }
  }

  private async profile(steamId: string, key: string, bypass?: boolean): Promise<CachedProfile> {
    const cacheKey = `faceit:profile:${steamId}`
    if (!bypass) {
      const cached = this.cache.get<CachedProfile>(cacheKey)
      if (cached) return cached
    }
    const url = `${API}/players?game=${GAME}&game_player_id=${encodeURIComponent(steamId)}`
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
