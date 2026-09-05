import type { ImportedMatch, ImportedMatchPlayer, MatchMode, Team, ValveInfo } from '@shared/types'
import { ApiError, type RequestManager } from './request-manager'
import { TTL, type CacheStore } from './cache'
import { logger } from '../logger'

/**
 * Leetify public API (v3). No key required.
 *   GET /v3/profile?steam64_id=...   -> Valve matchmaking profile: Premier rating, aim metrics, recent matches
 *   GET /v3/matches/{id}             -> one match with all players (used to identify a Valve lobby)
 *
 * Only Valve matchmaking data is used here (data_source === 'matchmaking').
 */
const API = 'https://api-public.cs-prod.leetify.com/v3'
const RANK_TYPE_PREMIER = 11
const RANK_TYPE_COMPETITIVE = 12

export interface LeetifyProfile {
  privacy_mode?: string
  winrate?: number
  total_matches?: number
  first_match_date?: string
  name?: string
  bans?: unknown[]
  steam64_id?: string
  id?: string
  ranks?: {
    leetify?: number | null
    premier?: number | null
    faceit?: number | null
    faceit_elo?: number | null
    wingman?: number | null
    competitive?: Array<{ map_name: string; rank: number }>
  }
  rating?: { aim?: number; positioning?: number; utility?: number; clutch?: number; opening?: number }
  stats?: Record<string, number>
  recent_matches?: LeetifyRecentMatch[]
}

export interface LeetifyRecentMatch {
  id: string
  finished_at: string
  data_source?: string
  outcome?: 'win' | 'loss' | 'tie' | string
  rank?: number
  rank_type?: number
  map_name?: string
  leetify_rating?: number
  score?: [number, number]
}

/** Match detail. Field names are read defensively because the payload is not formally documented. */
export interface LeetifyMatch {
  id?: string
  finished_at?: string
  map_name?: string
  data_source?: string
  rank_type?: number
  team_scores?: Array<{ team_number?: number; score?: number }>
  stats?: LeetifyMatchPlayer[]
  players?: LeetifyMatchPlayer[]
  [k: string]: unknown
}

export interface LeetifyMatchPlayer {
  steam64_id?: string
  steamId?: string
  name?: string
  initial_team_number?: number
  team_number?: number
  team?: number | string
  total_kills?: number
  total_deaths?: number
  total_assists?: number
  kills?: number
  deaths?: number
  assists?: number
  dpr?: number
  adr?: number
  total_hs_kills?: number
  hs_percentage?: number
  mvps?: number
  score?: number
  rank?: number
  leetify_rating?: number
  [k: string]: unknown
}

export type LeetifyLookupStatus = 'ok' | 'not_found' | 'unavailable'

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : undefined
}

export class LeetifyClient {
  constructor(
    private rm: RequestManager,
    private cache: CacheStore
  ) {}

  async profile(steamId: string, options: { bypassCache?: boolean } = {}): Promise<{ status: LeetifyLookupStatus; info?: ValveInfo; raw?: LeetifyProfile }> {
    const cacheKey = `leetify:profile:${steamId}`
    let raw: LeetifyProfile | { notFound: true } | undefined = options.bypassCache ? undefined : this.cache.get(cacheKey)
    if (!raw) {
      try {
        raw = await this.rm.getJson<LeetifyProfile>(cacheKey, `${API}/profile?steam64_id=${encodeURIComponent(steamId)}`, {
          headers: { Accept: 'application/json' }
        })
        this.cache.set(cacheKey, raw, TTL.faceitStats)
      } catch (err) {
        if (err instanceof ApiError && (err.kind === 'not_found' || err.kind === 'bad_request')) {
          raw = { notFound: true }
          this.cache.set(cacheKey, raw, TTL.faceitNotFound)
        } else {
          logger.warn('leetify.profile_failed', { steamId, error: (err as Error).message })
          return { status: 'unavailable' }
        }
      }
    }
    if ('notFound' in raw) return { status: 'not_found' }
    if (raw.privacy_mode && raw.privacy_mode !== 'public') {
      return { status: 'ok', raw, info: { profileUrl: `https://leetify.com/app/profile/${steamId}` } }
    }
    return { status: 'ok', raw, info: toValveInfo(raw, steamId) }
  }

  async match(matchId: string, options: { bypassCache?: boolean } = {}): Promise<LeetifyMatch | undefined> {
    const cacheKey = `leetify:match:${matchId}`
    if (!options.bypassCache) {
      const cached = this.cache.get<LeetifyMatch>(cacheKey)
      if (cached) return cached
    }
    try {
      const data = await this.rm.getJson<LeetifyMatch>(cacheKey, `${API}/matches/${encodeURIComponent(matchId)}`, {
        headers: { Accept: 'application/json' }
      })
      // finished matches never change
      this.cache.set(cacheKey, data, TTL.steamGames * 30)
      return data
    } catch (err) {
      logger.warn('leetify.match_failed', { matchId, error: (err as Error).message })
      return undefined
    }
  }
}

export function toValveInfo(p: LeetifyProfile, steamId: string): ValveInfo {
  const info: ValveInfo = { profileUrl: `https://leetify.com/app/profile/${steamId}` }
  const r = p.ranks
  if (r) {
    info.premierRating = num(r.premier)
    info.leetifyRating = num(r.leetify)
    if (r.competitive?.length) {
      info.competitiveRanks = {}
      for (const c of r.competitive) if (c.map_name) info.competitiveRanks[c.map_name] = c.rank
    }
  }
  info.totalMatches = num(p.total_matches)
  info.winRate = p.winrate !== undefined ? Math.round(p.winrate * 1000) / 10 : undefined
  info.firstMatchAt = p.first_match_date
  const st = p.stats ?? {}
  info.preaim = num(st.preaim)
  info.reactionTimeMs = num(st.reaction_time_ms)
  info.headshotAccuracy = num(st.accuracy_head)
  info.sprayAccuracy = num(st.spray_accuracy)
  info.accuracyEnemySpotted = num(st.accuracy_enemy_spotted)
  if (p.rating) info.ratings = { ...p.rating }
  if (Array.isArray(p.bans) && p.bans.length) info.bans = p.bans.map((b) => (typeof b === 'string' ? b : JSON.stringify(b)))

  const recent = (p.recent_matches ?? []).filter((m) => !m.data_source || m.data_source === 'matchmaking')
  if (recent.length) {
    const ratings = recent.map((m) => num(m.leetify_rating)).filter((v): v is number => v !== undefined)
    const premier = recent.filter((m) => m.rank_type === RANK_TYPE_PREMIER && num(m.rank) && (m.rank as number) > 0)
    info.recent = {
      matches: recent.length,
      wins: recent.filter((m) => m.outcome === 'win').length,
      losses: recent.filter((m) => m.outcome === 'loss').length,
      ties: recent.filter((m) => m.outcome === 'tie').length,
      avgLeetifyRating: ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100 : undefined,
      premierNow: premier[0]?.rank,
      premierThen: premier[premier.length - 1]?.rank
    }
  }
  return info
}

export function modeFromRankType(rankType: number | undefined): MatchMode {
  if (rankType === RANK_TYPE_PREMIER) return 'premier'
  if (rankType === RANK_TYPE_COMPETITIVE) return 'competitive'
  return 'other'
}

/**
 * Converts a Leetify match payload into our ImportedMatch. Teams are assigned
 * relative to `mySteamId`; when the payload has no usable players it returns undefined.
 */
export function toImportedMatch(m: LeetifyMatch, matchId: string, mySteamId: string | undefined, fallback?: LeetifyRecentMatch): ImportedMatch | undefined {
  const rows: LeetifyMatchPlayer[] = (m.stats ?? m.players ?? []) as LeetifyMatchPlayer[]
  const players = rows
    .map((row) => {
      const steamId = String(row.steam64_id ?? row.steamId ?? '')
      if (!/^7656119\d{10}$/.test(steamId)) return undefined
      const teamNo = num(row.initial_team_number ?? row.team_number ?? row.team)
      return { steamId, name: String(row.name ?? steamId), teamNo, row }
    })
    .filter((x): x is { steamId: string; name: string; teamNo: number | undefined; row: LeetifyMatchPlayer } => !!x)
  if (players.length === 0) return undefined

  const me = mySteamId ? players.find((p) => p.steamId === mySteamId) : undefined
  const myTeamNo = me?.teamNo
  const teamOf = (teamNo: number | undefined): Team => {
    if (myTeamNo === undefined || teamNo === undefined) return 'unknown'
    return teamNo === myTeamNo ? 'mine' : 'enemy'
  }
  const out: ImportedMatchPlayer[] = players.map((p) => {
    const kills = num(p.row.total_kills ?? p.row.kills) ?? 0
    const deaths = num(p.row.total_deaths ?? p.row.deaths) ?? 0
    const hsKills = num(p.row.total_hs_kills)
    return {
      steamId: p.steamId,
      name: p.name,
      team: teamOf(p.teamNo),
      stats: {
        kills,
        assists: num(p.row.total_assists ?? p.row.assists) ?? 0,
        deaths,
        mvps: num(p.row.mvps) ?? 0,
        headshotPercentage: num(p.row.hs_percentage) ?? (hsKills !== undefined && kills > 0 ? Math.round((hsKills / kills) * 100) : undefined),
        score: num(p.row.score) ?? 0,
        adr: num(p.row.dpr ?? p.row.adr),
        premierRating: num(p.row.rank),
        leetifyRating: num(p.row.leetify_rating)
      }
    }
  })

  // Scores: prefer team_scores, else the profile's recent match score (already my-team-first).
  let myScore: number | undefined
  let theirScore: number | undefined
  if (Array.isArray(m.team_scores) && m.team_scores.length >= 2 && myTeamNo !== undefined) {
    const mine = m.team_scores.find((t) => num(t.team_number) === myTeamNo)
    const theirs = m.team_scores.find((t) => num(t.team_number) !== myTeamNo)
    myScore = num(mine?.score)
    theirScore = num(theirs?.score)
  } else if (fallback?.score) {
    ;[myScore, theirScore] = fallback.score
  }
  let result: ImportedMatch['result'] = 'unknown'
  if (fallback?.outcome === 'win' || fallback?.outcome === 'loss' || fallback?.outcome === 'tie') result = fallback.outcome
  else if (myScore !== undefined && theirScore !== undefined) result = myScore > theirScore ? 'win' : myScore < theirScore ? 'loss' : 'tie'

  return {
    matchId,
    mode: modeFromRankType(num(m.rank_type) ?? fallback?.rank_type),
    map: (m.map_name as string | undefined) ?? fallback?.map_name,
    playedAt: (m.finished_at as string | undefined) ?? fallback?.finished_at ?? new Date().toISOString(),
    myScore,
    theirScore,
    result,
    players: out
  }
}
