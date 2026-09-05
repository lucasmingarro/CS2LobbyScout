/**
 * Shared domain types used by main, preload and renderer.
 * Keep this file free of runtime dependencies.
 */

export type Team = 'unknown' | 'mine' | 'enemy'

/**
 * How a player's Steam identity was established.
 *  - status:      the Steam ID was printed by `status` (community / FACEIT servers).
 *  - faceit_name: resolved by exact FACEIT nickname match (Valve servers hide ids). Unverified.
 *  - self:        matched the configured local Steam ID by persona name.
 *  - none:        name only, nothing could be resolved.
 */
export type IdentitySource = 'status' | 'faceit_name' | 'self' | 'none'

/** A player as extracted from raw CS2 `status` output. */
export interface LobbyPlayer {
  /** Stable key within a lobby: the Steam64 when known, otherwise `name:<lower-cased name>`. */
  key: string
  /** Steam64. Missing on official Valve servers, which no longer print ids in `status`. */
  steamId?: string
  name: string
  /** Connection state as printed by status (active, spawning, ...). */
  state?: string
  /** Steam account id (the X in [U:1:X]) when derivable. */
  accountId?: number
  ping?: number
  /** Connection time as printed by status, e.g. "06:53". */
  connectedFor?: string
  /** True when the line looks like the local client (loopback / matching MY_STEAM_ID). */
  isLocal?: boolean
}

export interface ParsedLobby {
  players: LobbyPlayer[]
  /** True when the text came from an official Valve server (ids hidden). */
  officialServer: boolean
  /** Map name when present in the spawngroups section. */
  map?: string
  /** Number of lines that looked like player rows but could not be parsed. */
  ignoredLines: number
  /** Lower-case sha-like fingerprint of the raw text (used to dedupe sessions). */
  rawHash: string
  /** Whether the text looks like genuine CS2 status output (not just random IDs). */
  looksLikeStatus: boolean
}

export type ScoutLevel = 'low' | 'mild' | 'elevated' | 'high' | 'very_high'

export interface ScoutSignal {
  type: string
  label: string
  points: number
  explanation: string
}

export interface ScoutResult {
  score: number
  level: ScoutLevel
  signals: ScoutSignal[]
  /** Per-component breakdown, mirrors the scout_scores table. */
  components: {
    kd: number
    adr: number
    hs: number
    accountAge: number
    matchCount: number
    winRate: number
    performanceJump: number
  }
  /** Human readable notes about data that was missing / ignored. */
  notes: string[]
}

export interface SteamInfo {
  personaName?: string
  avatarUrl?: string
  profileUrl?: string
  /** true when communityvisibilitystate !== 3 */
  profilePrivate?: boolean
  /** ISO date; only available for public profiles. */
  accountCreatedAt?: string
  /** Hours of CS2 (app 730) when the games list is public. */
  cs2Hours?: number
  vacBans?: number
  gameBans?: number
  daysSinceLastBan?: number
  communityBanned?: boolean
  economyBan?: string
}

export interface FaceitInfo {
  playerId?: string
  nickname?: string
  avatarUrl?: string
  country?: string
  profileUrl?: string
  level?: number
  elo?: number
  matches?: number
  kd?: number
  adr?: number
  headshotPercentage?: number
  winRate?: number
  /** Averages over the most recent matches (used for performance-jump detection). */
  recent?: {
    matches: number
    kd?: number
    adr?: number
    headshotPercentage?: number
    winRate?: number
  }
  /** ISO date of FACEIT account activation. */
  activatedAt?: string
}

export type SourceStatus = 'pending' | 'ok' | 'not_found' | 'unavailable' | 'no_key' | 'skipped' | 'no_id'

export interface SourceStatuses {
  steam: SourceStatus
  faceit: SourceStatus
  history: SourceStatus
}

export interface HistoryInfo {
  firstSeen?: string
  lastSeen?: string
  timesSeen: number
  previousScores: Array<{ score: number; capturedAt: string }>
}

export interface ScoutPlayer {
  /** Stable per-lobby key (see LobbyPlayer.key). Use this for UI identity. */
  key: string
  /** Steam64 once known. Enrichment, history and watching require it. */
  steamId?: string
  identity: IdentitySource
  name: string
  avatarUrl?: string
  team: Team
  isLocal: boolean
  ping?: number
  steam?: SteamInfo
  faceit?: FaceitInfo
  scout: ScoutResult
  history: HistoryInfo
  sources: SourceStatuses
  watched: boolean
}

export interface LobbySession {
  id: number
  createdAt: string
  source: 'paste' | 'clipboard'
  officialServer: boolean
  map?: string
  players: ScoutPlayer[]
}

export interface WatchedPlayerRow {
  steamId: string
  name: string
  avatarUrl?: string
  firstSeen: string
  lastSeen: string
  timesSeen: number
  lastScore?: number
  lastScoreAt?: string
  vacBans: number
  gameBans: number
  banState: 'none' | 'vac' | 'game' | 'both'
  banDetectedAt?: string
}

export interface BanEvent {
  id: number
  steamId: string
  name: string
  previousVacBans: number
  previousGameBans: number
  vacBans: number
  gameBans: number
  firstSeen?: string
  scoreWhenSeen?: number
  detectedAt: string
  acknowledged: boolean
}

export interface PlayerHistory {
  steamId: string
  name: string
  encounters: Array<{ encounteredAt: string; team: Team; sessionId: number }>
  scores: Array<{ score: number; capturedAt: string }>
  steamSnapshots: Array<{ capturedAt: string; vacBans: number; gameBans: number; profilePrivate: boolean }>
  faceitSnapshots: Array<{
    capturedAt: string
    level?: number
    elo?: number
    matches?: number
    kd?: number
    adr?: number
    headshotPercentage?: number
    winRate?: number
  }>
}

export interface AppSettings {
  autoDetectClipboard: boolean
  autoLoadDetectedLobby: boolean
  saveEncounterHistory: boolean
  alwaysOnTop: boolean
  compactMode: boolean
  showSuspicionScore: boolean
  showSignalDetails: boolean
  /** Steam64 of the local user, used to mark "You". Optional. */
  mySteamId: string
  /** Hours between automatic ban rechecks while the app is open. 0 disables. */
  banRecheckIntervalHours: number
  debugMode: boolean
}

export interface ApiKeyStatus {
  steam: boolean
  faceit: boolean
  /** Where the key is coming from. */
  steamSource: 'env' | 'settings' | 'none'
  faceitSource: 'env' | 'settings' | 'none'
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoDetectClipboard: true,
  autoLoadDetectedLobby: false,
  saveEncounterHistory: true,
  alwaysOnTop: false,
  compactMode: false,
  showSuspicionScore: true,
  showSignalDetails: true,
  mySteamId: '',
  banRecheckIntervalHours: 6,
  debugMode: false
}

export const SCORE_BANDS: Array<{ min: number; max: number; level: ScoutLevel; label: string }> = [
  { min: 0, max: 29, level: 'low', label: 'Low' },
  { min: 30, max: 49, level: 'mild', label: 'Mild' },
  { min: 50, max: 69, level: 'elevated', label: 'Elevated' },
  { min: 70, max: 84, level: 'high', label: 'High' },
  { min: 85, max: 100, level: 'very_high', label: 'Very High' }
]

export function scoreToLevel(score: number): ScoutLevel {
  const band = SCORE_BANDS.find((b) => score >= b.min && score <= b.max)
  return band ? band.level : score < 0 ? 'low' : 'very_high'
}

export function levelLabel(level: ScoutLevel): string {
  return SCORE_BANDS.find((b) => b.level === level)?.label ?? level
}
