import type { LobbySession, ScoutPlayer, Team } from '@shared/types'
import { parseStatus } from '@shared/lobby-parser'
import { computeScore, ENGINE_VERSION } from '@shared/scout-engine'
import { IPC } from '@shared/ipc'
import type { Repositories } from '../db/repositories'
import type { ConfigStore } from '../config'
import type { SteamClient } from './steam-client'
import type { FaceitClient } from './faceit-client'
import { errorFields, logger } from '../logger'

export type Emitter = (channel: string, payload: unknown) => void

interface ActiveSession {
  id?: number
  createdAt: string
  source: 'paste' | 'clipboard'
  rawHash: string
  players: Map<string, ScoutPlayer>
}

/**
 * Orchestrates: raw status -> parsed lobby -> Steam + FACEIT enrichment ->
 * suspicion score -> persistence. Enrichment runs in the background and every
 * player update is pushed to the renderer so the table fills in progressively.
 */
export class ScoutService {
  private session?: ActiveSession

  constructor(
    private repos: Repositories,
    private steam: SteamClient,
    private faceit: FaceitClient,
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
    return { id: s.id ?? 0, createdAt: s.createdAt, source: s.source, players: [...s.players.values()] }
  }

  /** Parses and starts enrichment. Returns immediately with placeholder rows. */
  loadLobby(raw: string, source: 'paste' | 'clipboard'): LobbySession {
    const settings = this.config.getSettings()
    const parsed = parseStatus(raw, { mySteamId: settings.mySteamId || undefined })
    if (parsed.players.length === 0) throw new Error('No Steam IDs found in the pasted text. Paste the full output of the `status` command.')

    logger.info('lobby.parse', { players: parsed.players.length, ignored: parsed.ignoredLines, source })

    const saveHistory = settings.saveEncounterHistory
    const sessionId = saveHistory ? this.repos.createSession(source, parsed.rawHash, settings.debugMode ? raw : undefined) : undefined

    const players = new Map<string, ScoutPlayer>()
    for (const p of parsed.players) {
      const isLocal = !!p.isLocal
      const team: Team = isLocal ? 'mine' : 'unknown'
      this.repos.upsertPlayerSeen(p.steamId, p.name, undefined, saveHistory)
      if (sessionId !== undefined) this.repos.addEncounter(sessionId, p.steamId, team)
      players.set(p.steamId, {
        steamId: p.steamId,
        name: p.name,
        team,
        isLocal,
        ping: p.ping,
        scout: computeScore({}),
        history: this.repos.history(p.steamId),
        sources: {
          steam: this.steam.hasKey() ? 'pending' : 'no_key',
          faceit: this.faceit.hasKey() ? 'pending' : 'no_key',
          history: 'ok'
        },
        watched: this.repos.isWatched(p.steamId)
      })
    }

    this.session = { id: sessionId, createdAt: new Date().toISOString(), source, rawHash: parsed.rawHash, players }
    const snapshot = this.toLobbySession(this.session)
    void this.enrichAll(this.session, false)
    return snapshot
  }

  private async enrichAll(session: ActiveSession, bypassCache: boolean): Promise<void> {
    const ids = [...session.players.keys()]
    await Promise.all([this.enrichSteam(session, ids, bypassCache), this.enrichFaceit(session, ids, bypassCache)])
  }

  private isCurrent(session: ActiveSession): boolean {
    return this.session === session
  }

  private pushUpdate(session: ActiveSession, player: ScoutPlayer): void {
    if (!this.isCurrent(session)) return
    this.emit(IPC.EVT_PLAYER_UPDATED, player)
  }

  private async enrichSteam(session: ActiveSession, ids: string[], bypassCache: boolean): Promise<void> {
    if (!this.steam.hasKey()) return
    let success = 0
    try {
      const results = await this.steam.lookup(ids, { bypassCache })
      for (const id of ids) {
        const player = session.players.get(id)
        const r = results.get(id)
        if (!player || !r) continue
        if (r.summaryOk || r.bansOk) {
          success++
          player.steam = r.info
          if (r.info.avatarUrl) player.avatarUrl = r.info.avatarUrl
          player.sources.steam = 'ok'
          if (r.bansOk) this.repos.insertSteamSnapshot(id, r.info)
          this.repos.updatePlayerIdentity(id, undefined, r.info.avatarUrl)
        } else {
          player.sources.steam = 'unavailable'
        }
        this.rescore(player)
        this.pushUpdate(session, player)
      }
    } catch (err) {
      logger.error('steam.lookup_failed', errorFields(err))
      for (const id of ids) {
        const player = session.players.get(id)
        if (player && player.sources.steam === 'pending') {
          player.sources.steam = 'unavailable'
          this.pushUpdate(session, player)
        }
      }
    }
    logger.info('steam.lookup', { players: ids.length, success })
  }

  private async enrichFaceit(session: ActiveSession, ids: string[], bypassCache: boolean): Promise<void> {
    if (!this.faceit.hasKey()) return
    let success = 0
    let notFound = 0
    await Promise.all(
      ids.map(async (id) => {
        const player = session.players.get(id)
        if (!player) return
        try {
          const r = await this.faceit.lookup(id, { bypassCache })
          player.sources.faceit = r.status
          if (r.status === 'ok' && r.info) {
            success++
            player.faceit = r.info
            if (!player.avatarUrl && r.info.avatarUrl) player.avatarUrl = r.info.avatarUrl
            this.repos.insertFaceitSnapshot(id, r.info)
          } else if (r.status === 'not_found') notFound++
        } catch (err) {
          player.sources.faceit = 'unavailable'
          logger.warn('faceit.lookup_failed', { steamId: id, ...errorFields(err) })
        }
        this.rescore(player)
        if (player.sources.faceit === 'ok') this.repos.insertScoutScore(id, ENGINE_VERSION, player.scout)
        this.pushUpdate(session, player)
      })
    )
    logger.info('faceit.lookup', { players: ids.length, success, not_found: notFound })
  }

  private rescore(player: ScoutPlayer): void {
    player.scout = computeScore({ steam: player.steam, faceit: player.faceit })
  }

  /** Re-fetch a single player bypassing the cache. */
  async refreshPlayer(steamId: string): Promise<ScoutPlayer | undefined> {
    const session = this.session
    const player = session?.players.get(steamId)
    if (!session || !player) return undefined
    player.sources.steam = this.steam.hasKey() ? 'pending' : 'no_key'
    player.sources.faceit = this.faceit.hasKey() ? 'pending' : 'no_key'
    this.pushUpdate(session, player)
    await Promise.all([this.enrichSteam(session, [steamId], true), this.enrichFaceit(session, [steamId], true)])
    player.history = this.repos.history(steamId)
    this.pushUpdate(session, player)
    return player
  }

  setTeam(steamId: string, team: Team): ScoutPlayer | undefined {
    const session = this.session
    const player = session?.players.get(steamId)
    if (!session || !player) return undefined
    player.team = team
    if (session.id !== undefined) this.repos.setEncounterTeam(session.id, steamId, team)
    return player
  }

  setWatched(steamId: string, watched: boolean): void {
    const player = this.session?.players.get(steamId)
    this.repos.setWatched(steamId, watched, player?.name)
    if (player) {
      player.watched = watched
      // Make sure a watched player has at least one ban snapshot to compare against later.
      if (watched && player.steam && player.steam.vacBans !== undefined && !this.repos.latestSteamSnapshot(steamId)) {
        this.repos.insertSteamSnapshot(steamId, player.steam)
      }
      if (watched && player.sources.faceit === 'ok' && !this.repos.latestScore(steamId)) {
        this.repos.insertScoutScore(steamId, ENGINE_VERSION, player.scout)
      }
    }
    logger.info(watched ? 'player.watch' : 'player.unwatch', { steamId })
  }
}
