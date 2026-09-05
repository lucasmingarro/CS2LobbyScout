import type { BanEvent } from '@shared/types'
import { IPC } from '@shared/ipc'
import type { Repositories } from '../db/repositories'
import type { SteamClient } from './steam-client'
import type { Emitter } from './scout-service'
import { errorFields, logger } from '../logger'

export interface RecheckResult {
  checked: number
  changed: BanEvent[]
  error?: string
}

/** Re-queries public ban state for watched players and records changes. */
export class BanRecheckService {
  private timer?: NodeJS.Timeout
  private running = false

  constructor(
    private repos: Repositories,
    private steam: SteamClient,
    private emit: Emitter
  ) {}

  async run(): Promise<RecheckResult> {
    if (this.running) return { checked: 0, changed: [] }
    this.running = true
    try {
      const ids = this.repos.watchedSteamIds()
      if (ids.length === 0) return { checked: 0, changed: [] }
      if (!this.steam.hasKey()) return { checked: 0, changed: [], error: 'Steam API key missing' }

      const bans = await this.steam.fetchBans(ids)
      const changed: BanEvent[] = []
      const dayMs = 24 * 60 * 60 * 1000
      for (const id of ids) {
        const cur = bans.get(id)
        if (!cur) continue
        const prev = this.repos.latestSteamSnapshot(id)
        const increased = prev && (cur.vacBans > prev.vacBans || cur.gameBans > prev.gameBans)
        if (increased) {
          const event = this.repos.insertBanEvent({
            steamId: id,
            previousVacBans: prev.vacBans,
            previousGameBans: prev.gameBans,
            vacBans: cur.vacBans,
            gameBans: cur.gameBans,
            scoreWhenSeen: this.repos.latestScore(id)?.score
          })
          changed.push(event)
          this.emit(IPC.EVT_BAN_DETECTED, event)
          logger.info('ban.detected', { steamId: id, vac: cur.vacBans, game: cur.gameBans })
        }
        const stale = !prev || Date.now() - Date.parse(prev.capturedAt) > dayMs
        if (increased || stale) {
          this.repos.insertSteamSnapshot(id, { vacBans: cur.vacBans, gameBans: cur.gameBans, daysSinceLastBan: cur.daysSinceLastBan })
        }
      }
      logger.info('ban.recheck', { watched: ids.length, changed: changed.length })
      return { checked: ids.length, changed }
    } catch (err) {
      logger.error('ban.recheck_failed', errorFields(err))
      return { checked: 0, changed: [], error: (err as Error).message }
    } finally {
      this.running = false
    }
  }

  schedule(intervalHours: number): void {
    this.stop()
    if (intervalHours <= 0) return
    const ms = intervalHours * 60 * 60 * 1000
    this.timer = setInterval(() => void this.run(), ms)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}
