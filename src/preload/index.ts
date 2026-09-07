import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  ApiKeyStatus,
  AppSettings,
  BanEvent,
  ImportResult,
  LobbySession,
  MatchSummary,
  ParsedLobby,
  PlayerHistory,
  ScoutPlayer,
  Team,
  WatchedPlayerRow
} from '@shared/types'

export interface LobbyDetectedEvent {
  /** What the clipboard watcher recognized. */
  kind: 'status' | 'faceit_room'
  autoLoaded: boolean
  session?: LobbySession
  raw?: string
  /** FACEIT match id when kind is 'faceit_room'. */
  matchId?: string
  playerCount: number
}

export type { ImportResult }

export interface RecheckResult {
  checked: number
  changed: BanEvent[]
  error?: string
}

export interface AppInfo {
  version: string
  userDataPath: string
  counts: { players: number; watched: number; sessions: number; matches: number; cache: number }
  session?: LobbySession
}

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  parsePreview: (raw: string): Promise<ParsedLobby> => ipcRenderer.invoke(IPC.LOBBY_PARSE_PREVIEW, raw),
  loadLobby: (raw: string, source: 'paste' | 'clipboard' = 'paste'): Promise<LobbySession> =>
    ipcRenderer.invoke(IPC.LOBBY_LOAD, raw, source),
  /** Loads the lobby of a FACEIT match from a room URL or a bare `1-<uuid>` id. */
  loadFaceitMatch: (urlOrId: string): Promise<LobbySession> => ipcRenderer.invoke(IPC.FACEIT_MATCH_LOAD, urlOrId),
  /** `key` is ScoutPlayer.key (Steam64 when known, otherwise a name key). */
  setTeam: (key: string, team: Team): Promise<ScoutPlayer | undefined> => ipcRenderer.invoke(IPC.LOBBY_SET_TEAM, key, team),
  refreshPlayer: (key: string): Promise<ScoutPlayer | undefined> => ipcRenderer.invoke(IPC.PLAYER_REFRESH, key),
  playerHistory: (steamId: string): Promise<PlayerHistory | undefined> => ipcRenderer.invoke(IPC.PLAYER_HISTORY, steamId),
  /** Returns the resulting watched state; false when the player has no Steam64. */
  watchPlayer: (key: string, watched: boolean): Promise<boolean> => ipcRenderer.invoke(IPC.PLAYER_WATCH, key, watched),
  listWatched: (): Promise<WatchedPlayerRow[]> => ipcRenderer.invoke(IPC.WATCHED_LIST),
  recheckBans: (): Promise<RecheckResult> => ipcRenderer.invoke(IPC.WATCHED_RECHECK),
  listBanEvents: (onlyUnacknowledged?: boolean): Promise<BanEvent[]> => ipcRenderer.invoke(IPC.BANS_LIST, onlyUnacknowledged),
  ackBanEvent: (id: number): Promise<boolean> => ipcRenderer.invoke(IPC.BANS_ACK, id),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
  keyStatus: (): Promise<ApiKeyStatus> => ipcRenderer.invoke(IPC.KEYS_STATUS),
  setKeys: (keys: { steam?: string; faceit?: string }): Promise<ApiKeyStatus> => ipcRenderer.invoke(IPC.KEYS_SET, keys),
  clearCache: (): Promise<boolean> => ipcRenderer.invoke(IPC.CACHE_CLEAR),
  clearHistory: (): Promise<boolean> => ipcRenderer.invoke(IPC.HISTORY_CLEAR),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.APP_INFO),
  importLastMatches: (limit?: number): Promise<ImportResult> => ipcRenderer.invoke(IPC.MATCHES_IMPORT, limit),
  listMatches: (): Promise<MatchSummary[]> => ipcRenderer.invoke(IPC.MATCHES_LIST),
  openMatch: (matchId: string): Promise<LobbySession | undefined> => ipcRenderer.invoke(IPC.MATCH_OPEN, matchId),

  onLobbyDetected: (cb: (e: LobbyDetectedEvent) => void) => on<LobbyDetectedEvent>(IPC.EVT_LOBBY_DETECTED, cb),
  onPlayerUpdated: (cb: (p: ScoutPlayer) => void) => on<ScoutPlayer>(IPC.EVT_PLAYER_UPDATED, cb),
  onBanDetected: (cb: (e: BanEvent) => void) => on<BanEvent>(IPC.EVT_BAN_DETECTED, cb),
  onLog: (cb: (line: string) => void) => on<string>(IPC.EVT_LOG, cb)
}

export type ScoutApi = typeof api

contextBridge.exposeInMainWorld('scout', api)
