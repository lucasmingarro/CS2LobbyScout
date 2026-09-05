import type { SteamInfo } from '@shared/types'
import { ApiError, type RequestManager } from './request-manager'
import { TTL, type CacheStore } from './cache'
import { logger } from '../logger'

const API = 'https://api.steampowered.com'
const CS2_APP_ID = 730

interface PlayerSummary {
  steamid: string
  personaname: string
  profileurl: string
  avatarfull?: string
  avatarmedium?: string
  communityvisibilitystate: number
  timecreated?: number
}

interface PlayerBan {
  SteamId: string
  CommunityBanned: boolean
  VACBanned: boolean
  NumberOfVACBans: number
  DaysSinceLastBan: number
  NumberOfGameBans: number
  EconomyBan: string
}

interface OwnedGames {
  response: { game_count?: number; games?: Array<{ appid: number; playtime_forever: number }> }
}

export interface SteamLookupResult {
  info: SteamInfo
  /** Which parts of the lookup succeeded. */
  summaryOk: boolean
  bansOk: boolean
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export class SteamClient {
  constructor(
    private rm: RequestManager,
    private cache: CacheStore,
    private getKey: () => string | undefined
  ) {}

  hasKey(): boolean {
    return !!this.getKey()
  }

  /** Enrich a set of Steam64 ids. Partial failures are tolerated per section. */
  async lookup(steamIds: string[], options: { bypassCache?: boolean; includePlaytime?: boolean } = {}): Promise<Map<string, SteamLookupResult>> {
    const key = this.getKey()
    const results = new Map<string, SteamLookupResult>()
    for (const id of steamIds) results.set(id, { info: {}, summaryOk: false, bansOk: false })
    if (!key) return results

    const [summaries, bans] = await Promise.all([
      this.summaries(steamIds, key, options.bypassCache),
      this.bans(steamIds, key, options.bypassCache)
    ])

    for (const id of steamIds) {
      const r = results.get(id)!
      const s = summaries.get(id)
      if (s) {
        r.summaryOk = true
        r.info.personaName = s.personaname
        r.info.avatarUrl = s.avatarfull ?? s.avatarmedium
        r.info.profileUrl = s.profileurl
        r.info.profilePrivate = s.communityvisibilitystate !== 3
        if (s.timecreated) r.info.accountCreatedAt = new Date(s.timecreated * 1000).toISOString()
      }
      const b = bans.get(id)
      if (b) {
        r.bansOk = true
        r.info.vacBans = b.NumberOfVACBans
        r.info.gameBans = b.NumberOfGameBans
        r.info.daysSinceLastBan = b.NumberOfVACBans + b.NumberOfGameBans > 0 ? b.DaysSinceLastBan : undefined
        r.info.communityBanned = b.CommunityBanned
        r.info.economyBan = b.EconomyBan
      }
    }

    if (options.includePlaytime !== false) {
      // One request per public profile; failures are silent (games list is often private).
      await Promise.all(
        steamIds
          .filter((id) => results.get(id)?.info.profilePrivate === false)
          .map(async (id) => {
            const hours = await this.cs2Hours(id, key, options.bypassCache)
            if (hours !== undefined) results.get(id)!.info.cs2Hours = hours
          })
      )
    }
    return results
  }

  /** Bans only (used by the watched-players recheck). Always bypasses cache. */
  async fetchBans(steamIds: string[]): Promise<Map<string, { vacBans: number; gameBans: number; daysSinceLastBan?: number }>> {
    const key = this.getKey()
    const out = new Map<string, { vacBans: number; gameBans: number; daysSinceLastBan?: number }>()
    if (!key) throw new ApiError('unauthorized', 'Steam API key missing')
    const bans = await this.bans(steamIds, key, true)
    for (const [id, b] of bans) {
      out.set(id, {
        vacBans: b.NumberOfVACBans,
        gameBans: b.NumberOfGameBans,
        daysSinceLastBan: b.NumberOfVACBans + b.NumberOfGameBans > 0 ? b.DaysSinceLastBan : undefined
      })
    }
    return out
  }

  private async summaries(ids: string[], key: string, bypass?: boolean): Promise<Map<string, PlayerSummary>> {
    return this.batched<PlayerSummary>(ids, 'steam:summary:', TTL.steamProfile, bypass, async (batch) => {
      const url = `${API}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(key)}&steamids=${batch.join(',')}`
      const data = await this.rm.getJson<{ response: { players: PlayerSummary[] } }>(`steam:summary:${batch.join(',')}`, url)
      return (data.response?.players ?? []).map((p) => [p.steamid, p] as const)
    })
  }

  private async bans(ids: string[], key: string, bypass?: boolean): Promise<Map<string, PlayerBan>> {
    return this.batched<PlayerBan>(ids, 'steam:bans:', TTL.steamBans, bypass, async (batch) => {
      const url = `${API}/ISteamUser/GetPlayerBans/v1/?key=${encodeURIComponent(key)}&steamids=${batch.join(',')}`
      const data = await this.rm.getJson<{ players: PlayerBan[] }>(`steam:bans:${batch.join(',')}`, url)
      return (data.players ?? []).map((p) => [p.SteamId, p] as const)
    })
  }

  private async cs2Hours(id: string, key: string, bypass?: boolean): Promise<number | undefined> {
    const cacheKey = `steam:games:${id}`
    if (!bypass) {
      const cached = this.cache.get<{ hours: number | null }>(cacheKey)
      if (cached) return cached.hours ?? undefined
    }
    try {
      const input = encodeURIComponent(JSON.stringify({ steamid: id, appids_filter: [CS2_APP_ID], include_played_free_games: true }))
      const url = `${API}/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(key)}&input_json=${input}`
      const data = await this.rm.getJson<OwnedGames>(cacheKey, url)
      const game = data.response?.games?.find((g) => g.appid === CS2_APP_ID)
      const hours = game ? Math.round(game.playtime_forever / 60) : null
      this.cache.set(cacheKey, { hours }, TTL.steamGames)
      return hours ?? undefined
    } catch (err) {
      logger.debug('steam.games_failed', { steamId: id, error: (err as Error).message })
      return undefined
    }
  }

  /**
   * Generic "cache first, then batch the misses" helper. Steam endpoints accept
   * up to 100 ids per call, so a full lobby is a single request per endpoint.
   */
  private async batched<T>(
    ids: string[],
    prefix: string,
    ttl: number,
    bypass: boolean | undefined,
    fetcher: (batch: string[]) => Promise<ReadonlyArray<readonly [string, T]>>
  ): Promise<Map<string, T>> {
    const out = new Map<string, T>()
    const misses: string[] = []
    for (const id of ids) {
      const cached = bypass ? undefined : this.cache.get<T>(prefix + id)
      if (cached) out.set(id, cached)
      else misses.push(id)
    }
    for (const batch of chunk(misses, 100)) {
      try {
        const rows = await fetcher(batch)
        for (const [id, value] of rows) {
          out.set(id, value)
          this.cache.set(prefix + id, value, ttl)
        }
      } catch (err) {
        logger.warn('steam.batch_failed', { endpoint: prefix, count: batch.length, error: (err as Error).message })
        if (err instanceof ApiError && err.kind === 'unauthorized') throw err
      }
    }
    return out
  }
}
