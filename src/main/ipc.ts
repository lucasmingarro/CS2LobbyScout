import { BrowserWindow, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc'
import { parseStatus } from '@shared/lobby-parser'
import type { AppSettings, Team } from '@shared/types'
import type { AppContext } from './context'
import { errorFields, logger, setDebug } from './logger'

const ALLOWED_HOSTS = ['steamcommunity.com', 'www.faceit.com', 'faceit.com', 'steamcommunity.com', 'developers.faceit.com']

export function registerIpc(ctx: AppContext): void {
  const { repos, scout, banRecheck, config, clipboardWatcher } = ctx

  ipcMain.handle(IPC.LOBBY_PARSE_PREVIEW, (_e, raw: string) => {
    const settings = config.getSettings()
    return parseStatus(String(raw ?? ''), { mySteamId: settings.mySteamId || undefined })
  })

  ipcMain.handle(IPC.LOBBY_LOAD, (_e, raw: string, source: 'paste' | 'clipboard' = 'paste') => {
    const session = scout.loadLobby(String(raw ?? ''), source)
    clipboardWatcher.markHandled(parseStatus(String(raw ?? '')).rawHash)
    return session
  })

  ipcMain.handle(IPC.LOBBY_SET_TEAM, (_e, steamId: string, team: Team) => scout.setTeam(steamId, team))

  ipcMain.handle(IPC.PLAYER_REFRESH, (_e, steamId: string) => scout.refreshPlayer(steamId))

  ipcMain.handle(IPC.PLAYER_HISTORY, (_e, steamId: string) => repos.fullHistory(steamId))

  ipcMain.handle(IPC.PLAYER_WATCH, (_e, steamId: string, watched: boolean) => {
    scout.setWatched(steamId, watched)
    return repos.isWatched(steamId)
  })

  ipcMain.handle(IPC.WATCHED_LIST, () => repos.listWatched())

  ipcMain.handle(IPC.WATCHED_RECHECK, () => banRecheck.run())

  ipcMain.handle(IPC.BANS_LIST, (_e, onlyUnacknowledged?: boolean) => repos.listBanEvents(!!onlyUnacknowledged))

  ipcMain.handle(IPC.BANS_ACK, (_e, id: number) => {
    repos.acknowledgeBanEvent(Number(id))
    return true
  })

  ipcMain.handle(IPC.SETTINGS_GET, () => config.getSettings())

  ipcMain.handle(IPC.SETTINGS_SET, (e, patch: Partial<AppSettings>) => {
    const next = config.setSettings(sanitizeSettings(patch))
    applySettings(ctx, next, BrowserWindow.fromWebContents(e.sender) ?? undefined)
    return next
  })

  ipcMain.handle(IPC.KEYS_STATUS, () => config.keyStatus())

  ipcMain.handle(IPC.KEYS_SET, (_e, keys: { steam?: string; faceit?: string }) => {
    config.setKeys({ steam: keys?.steam, faceit: keys?.faceit })
    return config.keyStatus()
  })

  ipcMain.handle(IPC.CACHE_CLEAR, () => {
    repos.cacheClear()
    logger.info('cache.cleared')
    return true
  })

  ipcMain.handle(IPC.HISTORY_CLEAR, () => {
    repos.clearHistory()
    logger.info('history.cleared')
    return true
  })

  ipcMain.handle(IPC.OPEN_EXTERNAL, async (_e, url: string) => {
    try {
      const u = new URL(String(url))
      if (u.protocol !== 'https:' || !ALLOWED_HOSTS.some((h) => u.host === h || u.host.endsWith('.' + h))) {
        logger.warn('shell.blocked_url', { url: String(url) })
        return false
      }
      await shell.openExternal(u.toString())
      return true
    } catch (err) {
      logger.warn('shell.open_failed', errorFields(err))
      return false
    }
  })

  ipcMain.handle(IPC.APP_INFO, () => ({
    version: ctx.version,
    userDataPath: ctx.userDataPath,
    counts: repos.counts(),
    session: scout.currentSession()
  }))
}

function sanitizeSettings(patch: Partial<AppSettings>): Partial<AppSettings> {
  const out: Partial<AppSettings> = {}
  const bools: Array<keyof AppSettings> = [
    'autoDetectClipboard',
    'autoLoadDetectedLobby',
    'saveEncounterHistory',
    'alwaysOnTop',
    'compactMode',
    'showSuspicionScore',
    'showSignalDetails',
    'debugMode'
  ]
  for (const k of bools) if (typeof patch[k] === 'boolean') (out as Record<string, unknown>)[k] = patch[k]
  if (typeof patch.mySteamId === 'string') out.mySteamId = patch.mySteamId.trim()
  if (typeof patch.banRecheckIntervalHours === 'number' && Number.isFinite(patch.banRecheckIntervalHours))
    out.banRecheckIntervalHours = Math.max(0, Math.min(168, patch.banRecheckIntervalHours))
  return out
}

export function applySettings(ctx: AppContext, s: AppSettings, win?: BrowserWindow): void {
  setDebug(s.debugMode)
  const target = win ?? BrowserWindow.getAllWindows()[0]
  if (target) target.setAlwaysOnTop(s.alwaysOnTop)
  if (s.autoDetectClipboard) ctx.clipboardWatcher.start()
  else ctx.clipboardWatcher.stop()
  ctx.banRecheck.schedule(s.banRecheckIntervalHours)
}
