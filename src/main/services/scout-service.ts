import type { IdentitySource, ImportedMatch, ImportResult, LobbySession, MatchSummary, ScoutPlayer, Team, ValveInfo } from '@shared/types'
import { parseStatus } from '@shared/lobby-parser'
import { computeScore, ENGINE_VERSION } from '@shared/scout-engine'
import { IPC } from '@shared/ipc'
import type { Repositories } from '../db/repositories'
import type { ConfigStore } from '../config'
import type { SteamClient } from './steam-client'
import type { FaceitClient } from './faceit-client'
import { toImportedMatch, type LeetifyClient } from './leetify-client'
import { errorFields, logger } from '../logger'

export type Emitter = (channel: string, payload: unknown) => void

/**
 * Combines the public Leetify profile with the aggregate built from imported
 * matches. Profile values win where they exist (they cover the player's whole
 * history); match aggregates fill the rest and always provide the Premier
 * rating, which the profile hides for non-Leetify users.
 */
export function mergeValve(profile: ValveInfo | undefined, local: ValveInfo | undefined): ValveInfo | undefined {
  const hasProfile = !!profile && (profile.premierRating !== undefined || profile.leetifyRating !== undefined || profile.preaim !== undefined)
  if (!hasProfile) return local
  if (!local) return { ...profile!, source: 'leetify_profile' }
  const pick = <K extends keyof ValveInfo>(key: K): ValveInfo[K] => (profile![key] !== undefined ? profile![key] : local[key])
  return {
    ...local,
    ...profile,
    source: 'mixed',
    sampleMatches: local.sampleMatches,
    premierRating: pick('premierRating'),
    premierRatingThen: local.premierRatingThen,
    premierWins: local.premierWins ?? profile!.premierWins,
    kd: pick('kd'),
    adr: pick('adr'),
    headshotPercentage: pick('headshotPercentage'),
    preaim: pick('preaim'),
    reactionTimeMs: pick('reactionTimeMs'),
    headshotAccuracy: pick('headshotAccuracy')
  }
}

interface ActiveSession {
  id?: number
  createdAt: string
  source: 'paste' | 'clipboard' | 'steam_history'
  rawHash: string
  officialServer: boolean
  map?: string
  match?: MatchSummary
  saveHistory: boolean
  players: Map<string, ScoutPlayer>
}

/**
 * Orchestrates: raw status -> parsed lobby -> identity resolution -> Steam +
 * FACEIT enrichment -> suspicion score -> persistence. Enrichment runs in the
 * background and every player update is pushed to the renderer.
 *
 * Identity: community / FACEIT servers print Steam ids in `status`. Official
 * Valve servers do not, so name-only players are resolved through an exact
 * FACEIT nickname match, which also yields their Steam64. That match is
 * flagged as unverified (`identity: 'faceit_name'`).
 */
export class ScoutService {
  private session?: ActiveSession
  private myPersona?: { steamId: string; name: string }

  constructor(
    private repos: Repositories,
    private steam: SteamClient,
    private faceit: FaceitClient,
    private leetify: LeetifyClient,
    private config: ConfigStore,
    private emit: Emitter
  ) {}

  currentRawHash(): string | undefined {
    return this.session?.rawHash
  }

  currentSession(): LobbySession | undefined {
    return this.session ? this.toLobbySession(this.session) : undefined
  }

  private toLobbySession(s: ActiveSession): LobbySession {
    return {
      id: s.id ?? 0,
      createdAt: s.createdAt,
      source: s.source,
      officialServer: s.officialServer,
      map: s.map,
      match: s.match,
      players: [...s.players.values()]
    }
  }

  /** Current Steam persona name of the configured local user (cached 24h by the Steam client). */
  private async myPersonaName(mySteamId: string): Promise<string | undefined> {
    if (this.myPersona?.steamId === mySteamId) return this.myPersona.name
    if (!this.steam.hasKey()) return undefined
    try {
      const res = await this.steam.lookup([mySteamId], { includePlaytime: false })
      const name = res.get(mySteamId)?.info.personaName
      if (name) this.myPersona = { steamId: mySteamId, name }
      return name
    } catch (err) {
      logger.debug('steam.persona_failed', errorFields(err))
      return undefined
    }
  }

  /** Parses and starts enrichment. Returns quickly with placeholder rows. */
  async loadLobby(raw: string, source: 'paste' | 'clipboard'): Promise<LobbySession> {
    const settings = this.config.getSettings()
    const mySteamId = settings.mySteamId || undefined
    const myName = mySteamId ? await this.myPersonaName(mySteamId) : undefined
    const parsed = parseStatus(raw, { mySteamId, myName })
    if (parsed.players.length === 0) {
      throw new Error('No players found in the pasted text. Copy the whole console output of the `status` command, including the players table.')
    }

    logger.info('lobby.parse', {
      players: parsed.players.length,
      withIds: parsed.players.filter((p) => p.steamId).length,
      official: parsed.officialServer,
      map: parsed.map,
      ignored: parsed.ignoredLines,
      source
    })

    const saveHistory = settings.saveEncounterHistory
    const sessionId = saveHistory ? this.repos.createSession(source, parsed.rawHash, settings.debugMode ? raw : undefined) : undefined

    const players = new Map<string, ScoutPlayer>()
    for (const p of parsed.players) {
      const isLocal = !!p.isLocal
      let steamId = p.steamId
      let identity: IdentitySource = steamId ? 'status' : 'none'
      if (!steamId && isLocal && mySteamId) {
        steamId = mySteamId
        identity = 'self'
      }
      const key = steamId ?? p.key
      const player: ScoutPlayer = {
        key,
        steamId,
        identity,
        name: p.name,
        team: isLocal ? 'mine' : 'unknown',
        isLocal,
        ping: p.ping,
        scout: computeScore({}),
        history: { timesSeen: 0, previousScores: [] },
        sources: {
          steam: !this.steam.hasKey() ? 'no_key' : steamId ? 'pending' : 'no_id',
          faceit: this.faceit.hasKey() ? 'pending' : 'no_key',
          valve: steamId ? 'pending' : 'no_id',
          history: 'ok'
        },
        watched: false
      }
      players.set(key, player)
    }

    const session: ActiveSession = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      source,
      rawHash: parsed.rawHash,
      officialServer: parsed.officialServer,
      map: parsed.map,
      saveHistory,
      players
    }
    for (const player of players.values()) if (player.steamId) this.registerIdentified(session, player)
    this.session = session

    const snapshot = this.toLobbySession(session)
    void this.enrichAll(session, [...players.keys()], false)
    return snapshot
  }

  /** Once a player has a Steam64, record the sighting and load their history. */
  private registerIdentified(session: ActiveSession, player: ScoutPlayer): void {
    if (!player.steamId) return
    this.repos.upsertPlayerSeen(player.steamId, player.name, player.avatarUrl, session.saveHistory)
    if (session.id !== undefined) this.repos.addEncounter(session.id, player.steamId, player.team)
    player.history = this.repos.history(player.steamId)
    player.watched = this.repos.isWatched(player.steamId)
  }

  private isCurrent(session: ActiveSession): boolean {
    return this.session === session
  }

  private pushUpdate(session: ActiveSession, player: ScoutPlayer): void {
    if (this.isCurrent(session)) this.emit(IPC.EVT_PLAYER_UPDATED, player)
  }

  private rescore(player: ScoutPlayer): void {
    player.scout = computeScore({ steam: player.steam, faceit: player.faceit, valve: player.valve })
  }

  private async enrichAll(session: ActiveSession, keys: string[], bypassCache: boolean): Promise<void> {
    const targets = keys.map((k) => session.players.get(k)).filter((p): p is ScoutPlayer => !!p)
    // FACEIT first: for name-only players it is also what gives us a Steam64.
    await Promise.all(targets.map((p) => this.enrichFaceit(session, p, bypassCache)))
    const identified = targets.filter((p) => p.steamId)
    await Promise.all([this.enrichSteam(session, identified, bypassCache), ...identified.map((p) => this.enrichValve(session, p, bypassCache))])
  }

  /**
   * Valve matchmaking statistics. Two sources, merged:
   *  - the player's public Leetify profile, which only exists for Leetify users;
   *  - the matches this app imported, which carry the full scoreboard and the
   *    Premier rating of all ten players whether or not they use Leetify.
   */
  private async enrichValve(session: ActiveSession, player: ScoutPlayer, bypassCache: boolean): Promise<void> {
    if (!player.steamId) {
      player.sources.valve = 'no_id'
      return
    }
    player.sources.valve = 'pending'
    const local = this.repos.valveAggregates([player.steamId]).get(player.steamId)
    try {
      const r = await this.leetify.profile(player.steamId, { bypassCache })
      const profile = r.status === 'ok' ? r.info : undefined
      const merged = mergeValve(profile, local)
      if (merged) {
        player.valve = merged
        player.sources.valve = 'ok'
      } else {
        player.sources.valve = r.status === 'ok' ? 'not_found' : r.status
      }
    } catch (err) {
      if (local) {
        player.valve = local
        player.sources.valve = 'ok'
      } else player.sources.valve = 'unavailable'
      logger.warn('valve.lookup_failed', { steamId: player.steamId, ...errorFields(err) })
    }
    this.rescore(player)
    if (player.sources.valve === 'ok' && player.steamId && player.valve && (player.valve.premierRating !== undefined || player.valve.leetifyRating !== undefined)) {
      this.repos.insertValveSnapshot(player.steamId, player.valve)
    }
    this.pushUpdate(session, player)
  }

  private async enrichFaceit(session: ActiveSession, player: ScoutPlayer, bypassCache: boolean): Promise<void> {
    if (!this.faceit.hasKey()) return
    try {
      if (player.steamId) {
        const r = await this.faceit.lookup(player.steamId, { bypassCache })
        player.sources.faceit = r.status
        if (r.status === 'ok' && r.info) player.faceit = r.info
      } else {
        const r = await this.faceit.lookupByNickname(player.name, { bypassCache })
        player.sources.faceit = r.status
        if (r.status === 'ok' && r.info && r.steamId) {
          player.faceit = r.info
          player.steamId = r.steamId
          player.identity = 'faceit_name'
          player.sources.steam = this.steam.hasKey() ? 'pending' : 'no_key'
          player.sources.valve = 'pending'
          this.registerIdentified(session, player)
          logger.info('identity.faceit_name', { name: player.name, steamId: r.steamId })
        }
      }
      if (player.faceit && !player.avatarUrl && player.faceit.avatarUrl) player.avatarUrl = player.faceit.avatarUrl
      if (player.sources.faceit === 'ok' && player.steamId && player.faceit) {
        this.repos.insertFaceitSnapshot(player.steamId, player.faceit)
      }
    } catch (err) {
      player.sources.faceit = 'unavailable'
      logger.warn('faceit.lookup_failed', { name: player.name, ...errorFields(err) })
    }
    this.rescore(player)
    if (player.sources.faceit === 'ok' && player.steamId) this.repos.insertScoutScore(player.steamId, ENGINE_VERSION, player.scout)
    this.pushUpdate(session, player)
  }

  private async enrichSteam(session: ActiveSession, players: ScoutPlayer[], bypassCache: boolean): Promise<void> {
    if (!this.steam.hasKey() || players.length === 0) return
    const ids = players.map((p) => p.steamId!)
    let success = 0
    try {
      const results = await this.steam.lookup(ids, { bypassCache })
      for (const player of players) {
        const r = results.get(player.steamId!)
        if (!r) continue
        if (r.summaryOk || r.bansOk) {
          success++
          player.steam = r.info
          if (r.info.avatarUrl) player.avatarUrl = r.info.avatarUrl
          player.sources.steam = 'ok'
          if (r.bansOk) this.repos.insertSteamSnapshot(player.steamId!, r.info)
          this.repos.updatePlayerIdentity(player.steamId!, undefined, r.info.avatarUrl)
        } else {
          player.sources.steam = 'unavailable'
        }
        this.rescore(player)
        this.pushUpdate(session, player)
      }
    } catch (err) {
      logger.error('steam.lookup_failed', errorFields(err))
      for (const player of players) {
        if (player.sources.steam === 'pending') {
          player.sources.steam = 'unavailable'
          this.pushUpdate(session, player)
        }
      }
    }
    logger.info('steam.lookup', { players: ids.length, success })
  }

  /** Re-fetch a single player bypassing the cache (also retries identity resolution). */
  async refreshPlayer(key: string): Promise<ScoutPlayer | undefined> {
    const session = this.session
    const player = session?.players.get(key)
    if (!session || !player) return undefined
    player.sources.steam = !this.steam.hasKey() ? 'no_key' : player.steamId ? 'pending' : 'no_id'
    player.sources.faceit = this.faceit.hasKey() ? 'pending' : 'no_key'
    player.sources.valve = player.steamId ? 'pending' : 'no_id'
    this.pushUpdate(session, player)
    await this.enrichAll(session, [key], true)
    if (player.steamId) player.history = this.repos.history(player.steamId)
    this.pushUpdate(session, player)
    return player
  }

  setTeam(key: string, team: Team): ScoutPlayer | undefined {
    const session = this.session
    const player = session?.players.get(key)
    if (!session || !player) return undefined
    player.team = team
    if (session.id !== undefined && player.steamId) this.repos.setEncounterTeam(session.id, player.steamId, team)
    return player
  }

  /** Returns the resulting watched state. Players without a Steam64 cannot be watched. */
  setWatched(key: string, watched: boolean): boolean {
    const player = this.session?.players.get(key)
    // Allow watching by raw Steam64 too (e.g. from the Watched screen).
    const steamId = player?.steamId ?? (/^7656119\d{10}$/.test(key) ? key : undefined)
    if (!steamId) return false
    this.repos.setWatched(steamId, watched, player?.name)
    if (player) {
      player.watched = watched
      if (watched && player.steam && player.steam.vacBans !== undefined && !this.repos.latestSteamSnapshot(steamId)) {
        this.repos.insertSteamSnapshot(steamId, player.steam)
      }
      if (watched && player.sources.faceit === 'ok' && !this.repos.latestScore(steamId)) {
        this.repos.insertScoutScore(steamId, ENGINE_VERSION, player.scout)
      }
    }
    logger.info(watched ? 'player.watch' : 'player.unwatch', { steamId })
    return watched
  }

  // ---- Leetify match import ------------------------------------------------------

  /**
   * Pulls the newest Valve matches of the configured Steam account from Leetify,
   * stores them, and back-fills the live lobby (names -> exact Steam64 + team).
   */
  async importLastMatches(limit = 10): Promise<ImportResult> {
    const settings = this.config.getSettings()
    const mySteamId = settings.mySteamId
    const result: ImportResult = { imported: 0, skipped: 0, pages: 0, backfilled: 0 }
    if (!mySteamId) return { ...result, error: 'Set your Steam64 ID in Settings first.' }

    const all = await this.leetify.profileMatches(mySteamId, { bypassCache: true })
    if (all.length === 0) {
      return { ...result, error: 'Leetify has no Valve matches for your account yet. Make sure you signed in at leetify.com with Steam and added the match authentication code.' }
    }
    const recent = all.slice(0, Math.max(1, Math.min(10, limit)))
    result.pages = 1

    const imported: ImportedMatch[] = []
    for (const rm of recent) {
      if (this.repos.hasMatch(rm.id)) {
        result.skipped++
        continue
      }
      const raw = await this.leetify.match(rm.id)
      if (!raw) {
        result.error = 'Leetify match details are not reachable right now.'
        continue
      }
      const match = toImportedMatch(raw, rm.id, mySteamId, {
        finished_at: rm.finished_at,
        map_name: rm.map_name,
        data_source: rm.data_source,
        team_scores: rm.team_scores
      })
      if (!match) continue
      if (this.repos.insertMatch(match, settings.saveEncounterHistory)) {
        result.imported++
        imported.push(match)
      } else result.skipped++
    }
    logger.info('leetify.import', { imported: result.imported, skipped: result.skipped })

    // Back-fill the live lobby from the newest match that actually looks like it (map + names).
    const candidates = recent.map((rm) => imported.find((m) => m.matchId === rm.id) ?? this.repos.getMatch(rm.id)).filter((m): m is ImportedMatch => !!m)
    for (const m of candidates) {
      const filled = await this.backfillFromMatch(m)
      if (filled > 0) {
        result.backfilled = filled
        break
      }
    }
    await this.refreshValveFromMatches()
    if (this.session && this.session.source !== 'steam_history' && result.backfilled === 0 && !result.error) {
      result.error = 'None of the imported matches corresponds to the current lobby yet. Leetify usually needs a few minutes after a match ends.'
    }
    return result
  }

  /** Recomputes the Valve line of the current lobby from the imported matches. */
  private async refreshValveFromMatches(): Promise<void> {
    const session = this.session
    if (!session) return
    const players = [...session.players.values()].filter((p) => p.steamId)
    if (players.length === 0) return
    const aggregates = this.repos.valveAggregates(players.map((p) => p.steamId!))
    for (const player of players) {
      const local = aggregates.get(player.steamId!)
      if (!local) continue
      const profile = player.valve?.source === 'matches' ? undefined : player.valve
      player.valve = mergeValve(profile, local)
      player.sources.valve = 'ok'
      this.rescore(player)
      if (player.valve) this.repos.insertValveSnapshot(player.steamId!, player.valve)
      this.pushUpdate(session, player)
    }
  }

  /**
   * Match live name-only players against an imported match and enrich them.
   * Requires the same map (when known) and at least three overlapping names so
   * a stale match never gets glued onto an unrelated lobby.
   */
  private async backfillFromMatch(match: ImportedMatch): Promise<number> {
    const session = this.session
    if (!session || session.source === 'steam_history') return 0
    if (session.map && match.map && session.map.toLowerCase() !== match.map.toLowerCase()) return 0
    const byName = new Map(match.players.map((p) => [p.name.trim().toLowerCase(), p]))
    const overlap = [...session.players.values()].filter((p) => byName.has(p.name.trim().toLowerCase())).length
    if (overlap < Math.min(3, match.players.length)) return 0
    const filled: ScoutPlayer[] = []
    for (const player of session.players.values()) {
      const mp = byName.get(player.name.trim().toLowerCase())
      if (!mp) continue
      const changed = player.steamId !== mp.steamId
      if (player.identity === 'status' && !changed) continue
      player.steamId = mp.steamId
      player.identity = mp.steamId === this.config.getSettings().mySteamId ? 'self' : 'leetify_match'
      player.team = mp.team !== 'unknown' ? mp.team : player.team
      player.matchStats = mp.stats
      if (changed) {
        player.faceit = undefined
        player.steam = undefined
        player.valve = undefined
        player.sources.faceit = this.faceit.hasKey() ? 'pending' : 'no_key'
        player.sources.steam = this.steam.hasKey() ? 'pending' : 'no_key'
        player.sources.valve = 'pending'
        this.registerIdentified(session, player)
        filled.push(player)
      }
      this.pushUpdate(session, player)
    }
    if (filled.length) {
      logger.info('lobby.backfill', { players: filled.length, matchId: match.matchId })
      await this.enrichAll(session, filled.map((p) => p.key), false)
    }
    return filled.length
  }

  listMatches(): MatchSummary[] {
    return this.repos.listMatches(100)
  }

  /** Shows a stored match as a lobby session (exact teams and per-match stats). */
  openMatch(matchId: string): LobbySession | undefined {
    const match = this.repos.getMatch(matchId)
    if (!match) return undefined
    const mySteamId = this.config.getSettings().mySteamId
    const players = new Map<string, ScoutPlayer>()
    for (const mp of match.players) {
      players.set(mp.steamId, {
        key: mp.steamId,
        steamId: mp.steamId,
        identity: mp.steamId === mySteamId ? 'self' : 'leetify_match',
        name: mp.name,
        avatarUrl: mp.avatarUrl,
        team: mp.team,
        isLocal: mp.steamId === mySteamId,
        matchStats: mp.stats,
        scout: computeScore({}),
        history: this.repos.history(mp.steamId),
        sources: {
          steam: this.steam.hasKey() ? 'pending' : 'no_key',
          faceit: this.faceit.hasKey() ? 'pending' : 'no_key',
          valve: 'pending',
          history: 'ok'
        },
        watched: this.repos.isWatched(mp.steamId)
      })
    }
    const { players: _p, ...summary } = match
    const session: ActiveSession = {
      createdAt: new Date().toISOString(),
      source: 'steam_history',
      rawHash: `match:${matchId}`,
      officialServer: true,
      map: match.map,
      match: { ...summary, playerCount: _p.length },
      saveHistory: false,
      players
    }
    this.session = session
    const snapshot = this.toLobbySession(session)
    void this.enrichAll(session, [...players.keys()], false)
    return snapshot
  }
}
