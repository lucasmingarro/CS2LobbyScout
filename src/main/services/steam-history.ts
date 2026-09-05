import { BrowserWindow, session, type Session } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ImportedMatch, ImportResult, MatchMode, SteamLoginStatus } from '@shared/types'
import { IPC } from '@shared/ipc'
import type { Repositories } from '../db/repositories'
import type { ConfigStore } from '../config'
import type { SteamClient } from './steam-client'
import type { Emitter } from './scout-service'
import { finalizeMatch, modeFromTab, parseMatchHistoryHtml, type RawMatch } from './steam-history-parser'
import { errorFields, logger } from '../logger'

const PARTITION = 'persist:steam'
const COMMUNITY = 'https://steamcommunity.com'
const TABS: Record<Exclude<MatchMode, 'other'>, string> = {
  premier: 'matchhistorypremier',
  competitive: 'matchhistorycompetitive',
  wingman: 'matchhistorywingman'
}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

/**
 * Imports the user's own CS2 match history from steamcommunity.com.
 *
 * The user signs in to Steam inside a dedicated BrowserWindow whose cookies
 * live in a persistent Electron partition on this machine. The pages are then
 * fetched with that session and parsed. No credentials ever touch our code:
 * we only see the resulting cookies, exactly like a browser would.
 */
export class SteamHistoryService {
  private loginWindow?: BrowserWindow
  private importing = false

  constructor(
    private repos: Repositories,
    private steam: SteamClient,
    private config: ConfigStore,
    private emit: Emitter,
    private logDir: string
  ) {}

  private ses(): Session {
    return session.fromPartition(PARTITION)
  }

  // ---- login -----------------------------------------------------------------

  async status(): Promise<SteamLoginStatus> {
    try {
      const cookies = await this.ses().cookies.get({ domain: 'steamcommunity.com', name: 'steamLoginSecure' })
      if (cookies.length === 0) return { loggedIn: false }
      const steamId = cookies[0].value.split('%7C')[0].split('|')[0]
      const valid = /^7656119\d{10}$/.test(steamId) ? steamId : undefined
      const mine = this.config.getSettings().mySteamId
      return { loggedIn: true, steamId: valid, mismatch: !!(valid && mine && valid !== mine) }
    } catch (err) {
      logger.warn('steam.status_failed', errorFields(err))
      return { loggedIn: false }
    }
  }

  openLogin(parent?: BrowserWindow): void {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.focus()
      return
    }
    const win = new BrowserWindow({
      width: 900,
      height: 760,
      parent,
      title: 'Sign in to Steam — CS2 Lobby Scout',
      autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    this.loginWindow = win
    win.webContents.setUserAgent(UA)
    const check = async (): Promise<void> => {
      const st = await this.status()
      if (st.loggedIn) {
        logger.info('steam.login_ok', { steamId: st.steamId })
        this.emit(IPC.EVT_STEAM_LOGIN, st)
        if (!win.isDestroyed()) win.close()
      }
    }
    win.webContents.on('did-navigate', () => void check())
    win.webContents.on('did-navigate-in-page', () => void check())
    win.on('closed', () => {
      this.loginWindow = undefined
      void this.status().then((st) => this.emit(IPC.EVT_STEAM_LOGIN, st))
    })
    void win.loadURL(`${COMMUNITY}/login/home/?goto=my%2Fgcpd%2F730%3Ftab%3Dmatchhistorycompetitive`)
  }

  async logout(): Promise<void> {
    await this.ses().clearStorageData({ storages: ['cookies', 'localstorage'] })
    logger.info('steam.logout')
    this.emit(IPC.EVT_STEAM_LOGIN, { loggedIn: false } satisfies SteamLoginStatus)
  }

  // ---- import ----------------------------------------------------------------

  private async fetchText(url: string): Promise<{ text: string; url: string; status: number }> {
    const res = await this.ses().fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json' },
      redirect: 'follow'
    })
    return { text: await res.text(), url: res.url, status: res.status }
  }

  private async sessionId(): Promise<string | undefined> {
    const cookies = await this.ses().cookies.get({ domain: 'steamcommunity.com', name: 'sessionid' })
    return cookies[0]?.value
  }

  /**
   * Fetch up to `pages` pages of one history tab. The first page is HTML, the
   * following ones come from the ajax endpoint as JSON with an `html` field.
   */
  private async fetchTab(mode: Exclude<MatchMode, 'other'>, pages: number, debug: boolean): Promise<RawMatch[]> {
    const tab = TABS[mode]
    const out: RawMatch[] = []
    const first = await this.fetchText(`${COMMUNITY}/my/gcpd/730?tab=${tab}`)
    if (debug) this.dump(`history-${tab}-1.html`, first.text)
    if (/\/login/.test(first.url) || !/csgo_scoreboard_root|gcpd/i.test(first.text)) {
      throw new Error('Steam session expired or match history not available. Sign in to Steam again.')
    }
    let page = parseMatchHistoryHtml(first.text, modeFromTab(tab))
    out.push(...page.matches)
    const sessionid = await this.sessionId()
    for (let i = 2; i <= pages && page.continueToken && sessionid; i++) {
      const url = `${COMMUNITY}/my/gcpd/730?ajax=1&tab=${tab}&continue_token=${encodeURIComponent(page.continueToken)}&sessionid=${encodeURIComponent(sessionid)}`
      const res = await this.fetchText(url)
      let html = ''
      let token: string | undefined
      try {
        const json = JSON.parse(res.text) as { success?: boolean; html?: string; continue_token?: string }
        if (!json.success || !json.html) break
        html = json.html
        token = json.continue_token
      } catch {
        break
      }
      if (debug) this.dump(`history-${tab}-${i}.html`, html)
      page = parseMatchHistoryHtml(`<table class="csgo_scoreboard_root"><tbody>${html}</tbody></table>`, modeFromTab(tab))
      page.continueToken = token
      out.push(...page.matches)
    }
    return out
  }

  private dump(name: string, text: string): void {
    try {
      writeFileSync(join(this.logDir, name), text)
    } catch {
      /* ignore */
    }
  }

  async importMatches(options: { modes?: MatchMode[]; pages?: number } = {}): Promise<ImportResult> {
    if (this.importing) return { imported: 0, skipped: 0, pages: 0, backfilled: 0, error: 'Import already running' }
    this.importing = true
    const settings = this.config.getSettings()
    const modes = (options.modes ?? ['premier', 'competitive']).filter((m): m is Exclude<MatchMode, 'other'> => m !== 'other')
    const pages = Math.max(1, Math.min(10, options.pages ?? 2))
    const result: ImportResult = { imported: 0, skipped: 0, pages: 0, backfilled: 0 }
    const imported: ImportedMatch[] = []
    try {
      const st = await this.status()
      if (!st.loggedIn) return { ...result, error: 'Not signed in to Steam.' }
      const mySteamId = settings.mySteamId || st.steamId

      for (const mode of modes) {
        let raws: RawMatch[]
        try {
          raws = await this.fetchTab(mode, pages, settings.debugMode)
        } catch (err) {
          logger.warn('history.fetch_failed', { mode, ...errorFields(err) })
          result.error = (err as Error).message
          continue
        }
        result.pages += Math.min(pages, Math.max(1, Math.ceil(raws.length / 8)))
        for (const raw of raws) {
          if (this.repos.hasMatch(raw.matchId)) {
            result.skipped++
            continue
          }
          // Resolve vanity urls (needs the Steam key; unresolved players are dropped).
          await Promise.all(
            raw.players
              .filter((p) => !p.steamId && p.vanity)
              .map(async (p) => {
                p.steamId = await this.steam.resolveVanity(p.vanity!)
              })
          )
          const match = finalizeMatch(raw, mySteamId)
          if (match.players.length === 0) continue
          if (this.repos.insertMatch(match, settings.saveEncounterHistory)) {
            result.imported++
            imported.push(match)
          } else result.skipped++
        }
      }
      logger.info('history.import', { imported: result.imported, skipped: result.skipped, modes: modes.join(',') })
      return result
    } catch (err) {
      logger.error('history.import_failed', errorFields(err))
      return { ...result, error: (err as Error).message }
    } finally {
      this.importing = false
      this.lastImported = imported
    }
  }

  /** Matches imported by the most recent run (used by the scout service to back-fill the live lobby). */
  lastImported: ImportedMatch[] = []
}
