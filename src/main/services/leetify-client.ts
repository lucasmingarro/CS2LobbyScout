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

/** One row of GET /v3/profile/matches?steam64_id=... (only the requested player's stats are included). */
export interface LeetifyProfileMatch {
  id: string
  finished_at: string
  data_source: string
  data_source_match_id?: string
  map_name?: string
  has_banned_player?: boolean
  team_scores?: Array<{ team_number: number; score: number }>
  stats?: Array<{ steam64_id: string; name?: string; initial_team_number?: number; rounds_won?: number; rounds_lost?: number }>
}

/** Match detail. Field names are read defensively because the payload is not formally documented. */
export interface LeetifyMatch {
  id?: string
  finished_at?: string
  finishedAt?: string
  map_name?: string
  mapName?: string
  data_source?: string
  dataSource?: string
  rank_type?: number
  rankType?: number
  team_scores?: Array<{ team_number?: number; teamNumber?: number; score?: number }>
  /** Legacy payload uses a plain [ourScore, theirScore] pair keyed by team number order. */
  teamScores?: Array<{ team_number?: number; teamNumber?: number; score?: number }> | number[]
  stats?: LeetifyMatchPlayer[]
  players?: LeetifyMatchPlayer[]
  playerStats?: LeetifyMatchPlayer[]
  /** Legacy api.leetify.com: Premier rating per player at match time. */
  matchmakingGameStats?: Array<{ steam64Id: string; rank?: number; oldRank?: number; rankType?: number; wins?: number }>
  parties?: Array<{ party: number; steam64Id: string }>
  hasBannedPlayer?: boolean
  details?: { serverName?: string }
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

  /** The player's Valve matches (Premier + Competitive), newest first. */
  async profileMatches(steamId: string, options: { bypassCache?: boolean } = {}): Promise<LeetifyProfileMatch[]> {
    const cacheKey = `leetify:profile-matches:${steamId}`
    if (!options.bypassCache) {
      const cached = this.cache.get<LeetifyProfileMatch[]>(cacheKey)
      if (cached) return cached
    }
    try {
      const data = await this.rm.getJson<LeetifyProfileMatch[]>(cacheKey, `${API}/profile/matches?steam64_id=${encodeURIComponent(steamId)}`, {
        headers: { Accept: 'application/json' }
      })
      const rows = (Array.isArray(data) ? data : []).filter((m) => m && typeof m.id === 'string' && isValveSource(m.data_source))
      rows.sort((a, b) => Date.parse(b.finished_at) - Date.parse(a.finished_at))
      this.cache.set(cacheKey, rows, 10 * 60 * 1000)
      return rows
    } catch (err) {
      logger.warn('leetify.profile_matches_failed', { steamId, error: (err as Error).message })
      return []
    }
  }

  /**
   * Match detail with all ten players. The documented v3 API has no such
   * endpoint yet, so the legacy api.leetify.com route is tried first and the
   * v3 candidates after it; the working prefix is remembered. Finished matches
   * never change, so results are cached for a long time.
   */
  async match(matchId: string, options: { bypassCache?: boolean } = {}): Promise<LeetifyMatch | undefined> {
    const cacheKey = `leetify:match:${matchId}`
    if (!options.bypassCache) {
      const cached = this.cache.get<LeetifyMatch>(cacheKey)
      if (cached) return cached
    }
    const id = encodeURIComponent(matchId)
    const candidates = [
      `https://api.leetify.com/api/games/${id}`,
      `${API}/matches/${id}`,
      `${API}/matches?id=${id}`,
      `${API}/match?id=${id}`
    ]
    const preferred = this.cache.get<{ url: string }>('leetify:match-endpoint')?.url
    if (preferred) candidates.sort((a, b) => (a.startsWith(preferred) ? -1 : b.startsWith(preferred) ? 1 : 0))
    for (const url of candidates) {
      try {
        const data = await this.rm.getJson<LeetifyMatch>(`${cacheKey}:${url}`, url, { headers: { Accept: 'application/json' } })
        if (!data || typeof data !== 'object') continue
        const rows = (data.stats ?? data.players ?? (data as { playerStats?: unknown[] }).playerStats) as unknown[] | undefined
        if (!Array.isArray(rows) || rows.length === 0) continue
        this.cache.set(cacheKey, data, TTL.steamGames * 30)
        this.cache.set('leetify:match-endpoint', { url: url.split(id)[0] }, TTL.steamGames * 30)
        return data
      } catch (err) {
        logger.debug('leetify.match_candidate_failed', { url: url.split('?')[0], error: (err as Error).message })
      }
    }
    logger.warn('leetify.match_failed', { matchId })
    return undefined
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

export function isValveSource(dataSource: string | undefined): boolean {
  return dataSource === 'matchmaking' || dataSource === 'matchmaking_competitive' || dataSource === 'matchmaking_wingman'
}

export function modeFromDataSource(dataSource: string | undefined): MatchMode | undefined {
  if (dataSource === 'matchmaking') return 'premier'
  if (dataSource === 'matchmaking_competitive') return 'competitive'
  if (dataSource === 'matchmaking_wingman') return 'wingman'
  return undefined
}

/**
 * Converts a Leetify match payload into our ImportedMatch. Teams are assigned
 * relative to `mySteamId`; when the payload has no usable players it returns undefined.
 */
export function toImportedMatch(
  m: LeetifyMatch,
  matchId: string,
  mySteamId: string | undefined,
  fallback?: Pick<LeetifyRecentMatch, 'finished_at' | 'map_name' | 'rank_type' | 'outcome' | 'score' | 'data_source'> & { team_scores?: Array<{ team_number: number; score: number }> }
): ImportedMatch | undefined {
  const ranks = new Map<string, { rank?: number; oldRank?: number; wins?: number }>()
  for (const r of m.matchmakingGameStats ?? []) if (r?.steam64Id) ranks.set(String(r.steam64Id), r)
  const parties = new Map<string, number>()
  for (const p of m.parties ?? []) if (p?.steam64Id) parties.set(String(p.steam64Id), p.party)
  const pct = (v: unknown): number | undefined => {
    const n = num(v)
    return n === undefined ? undefined : n <= 1 ? Math.round(n * 1000) / 10 : n
  }
  const rows: LeetifyMatchPlayer[] = (m.stats ?? m.players ?? m.playerStats ?? []) as LeetifyMatchPlayer[]
  const g = (row: LeetifyMatchPlayer, ...keys: string[]): unknown => {
    for (const k of keys) if (row[k] !== undefined && row[k] !== null) return row[k]
    return undefined
  }
  const players = rows
    .map((row) => {
      const steamId = String(g(row, 'steam64_id', 'steam64Id', 'steamId', 'steam_id') ?? '')
      if (!/^7656119\d{10}$/.test(steamId)) return undefined
      const teamNo = num(g(row, 'initial_team_number', 'initialTeamNumber', 'team_number', 'teamNumber', 'team'))
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
    const kills = num(g(p.row, 'total_kills', 'totalKills', 'kills')) ?? 0
    const deaths = num(g(p.row, 'total_deaths', 'totalDeaths', 'deaths')) ?? 0
    const hsKills = num(g(p.row, 'total_hs_kills', 'totalHsKills'))
    const rank = ranks.get(p.steamId)
    const reaction = num(g(p.row, 'reaction_time', 'reactionTime'))
    const lr = num(g(p.row, 'leetify_rating', 'leetifyRating'))
    return {
      steamId: p.steamId,
      name: p.name,
      team: teamOf(p.teamNo),
      stats: {
        kills,
        assists: num(g(p.row, 'total_assists', 'totalAssists', 'assists')) ?? 0,
        deaths,
        mvps: num(g(p.row, 'mvps', 'total_mvps', 'totalMvps')) ?? 0,
        headshotPercentage: pct(g(p.row, 'hsp', 'hs_percentage', 'hsPercentage')) ?? (hsKills !== undefined && kills > 0 ? Math.round((hsKills / kills) * 100) : undefined),
        score: num(g(p.row, 'score', 'total_score', 'totalScore')) ?? 0,
        adr: num(g(p.row, 'dpr', 'adr', 'total_damage_per_round')),
        premierRating: rank?.rank ?? num(g(p.row, 'rank', 'premier_rating')),
        premierRatingBefore: rank?.oldRank,
        premierWins: rank?.wins,
        leetifyRating: lr === undefined ? undefined : Math.abs(lr) <= 1 ? Math.round(lr * 10000) / 100 : lr,
        preaim: num(g(p.row, 'preaim')),
        reactionTimeMs: reaction === undefined ? undefined : reaction <= 5 ? Math.round(reaction * 1000) : reaction,
        headshotAccuracy: pct(g(p.row, 'accuracy_head', 'accuracyHead')),
        party: parties.get(p.steamId)
      }
    }
  })

  // Scores. Most reliable: my own rounds won / lost from the player row (legacy payload).
  let myScore: number | undefined
  let theirScore: number | undefined
  const meRow = me?.row
  const won = meRow ? num(meRow.ctRoundsWon) : undefined
  const lost = meRow ? num(meRow.ctRoundsLost) : undefined
  if (meRow && won !== undefined && lost !== undefined) {
    myScore = won + (num(meRow.tRoundsWon) ?? 0)
    theirScore = lost + (num(meRow.tRoundsLost) ?? 0)
  }
  const teamScores = (m.team_scores ?? m.teamScores ?? fallback?.team_scores) as Array<{ team_number?: number; teamNumber?: number; score?: number }> | number[] | undefined
  if (myScore === undefined && Array.isArray(teamScores) && teamScores.length >= 2 && myTeamNo !== undefined && typeof teamScores[0] === 'object') {
    const ts = teamScores as Array<{ team_number?: number; teamNumber?: number; score?: number }>
    const mine = ts.find((t) => num(t.team_number ?? t.teamNumber) === myTeamNo)
    const theirs = ts.find((t) => num(t.team_number ?? t.teamNumber) !== myTeamNo)
    myScore = num(mine?.score)
    theirScore = num(theirs?.score)
  }
  if (myScore === undefined && fallback?.score) [myScore, theirScore] = fallback.score
  let result: ImportedMatch['result'] = 'unknown'
  if (fallback?.outcome === 'win' || fallback?.outcome === 'loss' || fallback?.outcome === 'tie') result = fallback.outcome
  else if (myScore !== undefined && theirScore !== undefined) result = myScore > theirScore ? 'win' : myScore < theirScore ? 'loss' : 'tie'

  const anyRank = [...ranks.values()].find((r) => r.rank !== undefined) as { rankType?: number } | undefined
  return {
    matchId,
    mode:
      modeFromDataSource((m.data_source ?? m.dataSource) as string | undefined) ??
      modeFromDataSource(fallback?.data_source) ??
      modeFromRankType(num(m.rank_type ?? m.rankType) ?? fallback?.rank_type ?? num(anyRank?.rankType)),
    map: (m.map_name ?? m.mapName) ?? fallback?.map_name,
    playedAt: (m.finished_at ?? m.finishedAt) ?? fallback?.finished_at ?? new Date().toISOString(),
    myScore,
    theirScore,
    result,
    players: out,
    serverName: m.details?.serverName,
    hasBannedPlayer: m.hasBannedPlayer ?? (m as { has_banned_player?: boolean }).has_banned_player
  }
}
