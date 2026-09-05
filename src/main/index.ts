import { app, BrowserWindow, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { config as loadDotenv } from 'dotenv'
import { IPC } from '@shared/ipc'
import { ConfigStore } from './config'
import { openDatabase } from './db/database'
import { Repositories } from './db/repositories'
import { RequestManager } from './services/request-manager'
import { SteamClient } from './services/steam-client'
import { FaceitClient } from './services/faceit-client'
import { ScoutService } from './services/scout-service'
import { BanRecheckService } from './services/ban-recheck'
import { ClipboardWatcher } from './clipboard-watcher'
import { applySettings, registerIpc } from './ipc'
import type { AppContext } from './context'
import { errorFields, initLogger, logger } from './logger'
import type { CacheStore } from './services/cache'

// %APPDATA%/CS2LobbyScout on Windows, ~/.config/CS2LobbyScout on Linux, ~/Library/Application Support/CS2LobbyScout on macOS.
app.setPath('userData', join(app.getPath('appData'), 'CS2LobbyScout'))

// Development only: load API keys from the project's .env. Packaged builds use the Settings screen.
if (!app.isPackaged) {
  const envFile = join(app.getAppPath(), '.env')
  if (existsSync(envFile)) loadDotenv({ path: envFile })
}

let mainWindow: BrowserWindow | undefined
let ctx: AppContext | undefined

function emitToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function buildContext(): AppContext {
  const userDataPath = app.getPath('userData')
  const config = new ConfigStore(userDataPath)
  const settings = config.getSettings()
  initLogger(join(userDataPath, 'logs'), {
    debug: settings.debugMode || !app.isPackaged,
    sink: (line) => emitToRenderer(IPC.EVT_LOG, line)
  })
  logger.info('app.start', { version: app.getVersion(), packaged: app.isPackaged, userData: userDataPath })

  const db = openDatabase(join(userDataPath, 'scout.db'))
  const repos = new Repositories(db)
  repos.cachePurgeExpired()

  const cache: CacheStore = {
    get: (k) => repos.cacheGet(k),
    set: (k, v, ttl) => repos.cacheSet(k, v, ttl),
    deleteByPrefix: (p) => repos.cacheDeleteByPrefix(p)
  }
  const rm = new RequestManager({ concurrencyPerHost: 4 })
  const steam = new SteamClient(rm, cache, () => config.getKey('steam').value)
  const faceit = new FaceitClient(rm, cache, () => config.getKey('faceit').value)
  const scout = new ScoutService(repos, steam, faceit, config, emitToRenderer)
  const banRecheck = new BanRecheckService(repos, steam, emitToRenderer)
  const clipboardWatcher = new ClipboardWatcher((d) => {
    const s = config.getSettings()
    if (d.rawHash === scout.currentRawHash()) return
    if (s.autoLoadDetectedLobby) {
      scout
        .loadLobby(d.raw, 'clipboard')
        .then((session) => emitToRenderer(IPC.EVT_LOBBY_DETECTED, { autoLoaded: true, session, playerCount: d.playerCount }))
        .catch((err) => {
          logger.warn('clipboard.autoload_failed', errorFields(err))
          emitToRenderer(IPC.EVT_LOBBY_DETECTED, { autoLoaded: false, raw: d.raw, playerCount: d.playerCount })
        })
      return
    }
    emitToRenderer(IPC.EVT_LOBBY_DETECTED, { autoLoaded: false, raw: d.raw, playerCount: d.playerCount })
  })

  const keyStatus = config.keyStatus()
  logger.info('app.keys', { steam: keyStatus.steamSource, faceit: keyStatus.faceitSource })

  return { version: app.getVersion(), userDataPath, config, repos, scout, banRecheck, clipboardWatcher }
}

function createWindow(context: AppContext): BrowserWindow {
  const settings = context.config.getSettings()
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    title: 'CS2 Lobby Scout',
    alwaysOnTop: settings.alwaysOnTop,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  ctx = buildContext()
  registerIpc(ctx)
  mainWindow = createWindow(ctx)
  applySettings(ctx, ctx.config.getSettings(), mainWindow)

  // Recheck bans of watched players shortly after start-up.
  setTimeout(() => void ctx?.banRecheck.run(), 5000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && ctx) mainWindow = createWindow(ctx)
  })
})

app.on('window-all-closed', () => {
  ctx?.clipboardWatcher.stop()
  ctx?.banRecheck.stop()
  if (process.platform !== 'darwin') app.quit()
})

process.on('uncaughtException', (err) => logger.error('app.uncaught', errorFields(err)))
process.on('unhandledRejection', (reason) => logger.error('app.unhandled_rejection', errorFields(reason)))
