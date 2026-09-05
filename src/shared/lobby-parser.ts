import type { LobbyPlayer, ParsedLobby } from './types'
import { accountIdToSteam64, isSteam64, steam2ToAccountId, steam64ToAccountId } from './steam-id'

/**
 * Parser for the CS2 console `status` command.
 *
 * Layouts we accept:
 *
 *   CS2 on official Valve servers (Steam ids are HIDDEN, only names):
 *     [Client] ---------players--------
 *     [Client]   id     time ping loss      state   rate name
 *     [Client] 65280    00:09   75    0   spawning 786432 'Ramiirez'
 *     [Client] 65535 [NoChan]    0    0 challenging      0 ''
 *
 *   CS2 on community / FACEIT servers (ids present):
 *     0      06:53   35    0     active 786432 [U:1:123456789] 'nickname'
 *
 *   CS:GO legacy:
 *     #  3 1 "nickname" STEAM_1:0:12345 05:23 61 0 active 196608
 *
 * Strategy: for every line look for a Steam identifier first. If none is found
 * but the line has the shape of a CS2 player row (id, time, ping, loss, state,
 * rate, quoted name) the player is kept with a name-only identity so it can be
 * resolved later (e.g. by FACEIT nickname).
 */

const RE_STEAM3 = /\[U:1:(\d{1,10})\]/
const RE_STEAM2 = /STEAM_[0-5]:([01]):(\d{1,10})/
const RE_STEAM64 = /(?<![\d])(7656119\d{10})(?![\d])/
const RE_TIME = /(?:^|\s)(\d{1,3}:\d{2}(?::\d{2})?)(?=\s)/
const RE_LOCAL_HINT = /\bloopback\b/i
const RE_PREFIX = /^\s*\[(?:Client|Server|EngineServiceManager)\]\s?/
/** CS2 row without id: `65280    00:09   75    0   spawning 786432 'name'` */
const RE_CS2_ROW = /^\s*(\d{1,6})\s+(\d{1,3}:\d{2})\s+(\d{1,4})\s+(\d{1,4})\s+([a-z]+)\s+(\d+)\s+'(.*)'\s*$/i
const RE_MAP = /SV:\s+\[\d+:\s*([a-z0-9_]+)\s*\|\s*main lump\s*\|\s*mapload\s*\]/i
const RE_OFFICIAL = /Official Valve Server/i

const STATUS_MARKERS = [
  /---------players--------/i,
  /^\s*(?:\[Client\]\s*)?#\s*userid\s+name\s+uniqueid/im,
  /^\s*(?:\[Client\]\s*)?id\s+time\s+ping\s+loss\s+state/im,
  /^\s*(?:\[Client\]\s*)?#end\s*$/im,
  /^\s*Server:\s/im,
  /^\s*Client:\s/im,
  /^\s*(?:\[Client\]\s*)?players\s*:\s*\d+\s+humans/im
]

interface IdMatch {
  steamId: string
  accountId?: number
  start: number
  end: number
}

export function nameKey(name: string): string {
  return `name:${name.trim().toLowerCase()}`
}

function findSteamId(line: string): IdMatch | undefined {
  const m3 = RE_STEAM3.exec(line)
  if (m3) {
    const accountId = Number(m3[1])
    return { steamId: accountIdToSteam64(accountId), accountId, start: m3.index, end: m3.index + m3[0].length }
  }
  const m2 = RE_STEAM2.exec(line)
  if (m2) {
    const accountId = steam2ToAccountId(Number(m2[1]), Number(m2[2]))
    return { steamId: accountIdToSteam64(accountId), accountId, start: m2.index, end: m2.index + m2[0].length }
  }
  const m64 = RE_STEAM64.exec(line)
  if (m64 && isSteam64(m64[1])) {
    return {
      steamId: m64[1],
      accountId: steam64ToAccountId(m64[1]),
      start: m64.index,
      end: m64.index + m64[0].length
    }
  }
  return undefined
}

function extractName(line: string, id: IdMatch): string | undefined {
  const after = line.slice(id.end)
  const before = line.slice(0, id.start)
  const candidates = [
    /'(.*)'/.exec(after)?.[1],
    /"(.*)"/.exec(after)?.[1],
    /"(.*)"/.exec(before)?.[1],
    /'(.*)'/.exec(before)?.[1]
  ]
  for (const c of candidates) {
    if (c !== undefined) {
      const trimmed = c.trim()
      if (trimmed.length > 0) return trimmed
    }
  }
  const tokens = (after.trim() || before.trim()).split(/\s+/).filter(Boolean)
  return tokens.reverse().find((t) => !/^[\d:.]+$/.test(t) && !/^(active|spawning|connecting|challenging)$/i.test(t))
}

function extractPing(line: string): { ping?: number; connectedFor?: string; state?: string } {
  const stripped = line.replace(/'(.*)'/, ' ').replace(/"(.*)"/, ' ')
  const timeMatch = RE_TIME.exec(stripped)
  if (!timeMatch) return {}
  const rest = stripped.slice(timeMatch.index + timeMatch[0].length).trim().split(/\s+/)
  const ping = rest[0] && /^\d{1,4}$/.test(rest[0]) ? Number(rest[0]) : undefined
  const state = rest.find((t) => /^(active|spawning|connecting|challenging)$/i.test(t))?.toLowerCase()
  return { ping, connectedFor: timeMatch[1], state }
}

/** Small, dependency-free FNV-1a hash used to fingerprint raw status text. */
export function fingerprint(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  let h = 0x811c9dc5
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0') + normalized.length.toString(16)
}

export interface ParseOptions {
  /** Steam64 of the local user, used to flag `isLocal` when ids are present. */
  mySteamId?: string
  /** Current Steam persona name of the local user, used to flag `isLocal` when ids are hidden. */
  myName?: string
}

export function parseStatus(raw: string, options: ParseOptions = {}): ParsedLobby {
  const text = (raw ?? '').replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  const players = new Map<string, LobbyPlayer>()
  let ignoredLines = 0
  let map: string | undefined
  const myNameLower = options.myName?.trim().toLowerCase()

  const add = (p: LobbyPlayer): void => {
    const existing = players.get(p.key)
    if (existing) {
      existing.ping ??= p.ping
      existing.connectedFor ??= p.connectedFor
      existing.state ??= p.state
      existing.isLocal ||= p.isLocal
      return
    }
    players.set(p.key, p)
  }

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue
    const line = rawLine.replace(RE_PREFIX, '')

    if (!map) {
      const m = RE_MAP.exec(line)
      if (m) map = m[1]
    }

    const id = findSteamId(line)
    if (id) {
      const name = extractName(line, id)
      if (!name) {
        ignoredLines++
        continue
      }
      const { ping, connectedFor, state } = extractPing(line)
      const isLocal =
        (!!options.mySteamId && options.mySteamId === id.steamId) ||
        RE_LOCAL_HINT.test(line) ||
        (!!myNameLower && name.toLowerCase() === myNameLower) ||
        undefined
      add({ key: id.steamId, steamId: id.steamId, accountId: id.accountId, name, ping, connectedFor, state, isLocal })
      continue
    }

    const row = RE_CS2_ROW.exec(line)
    if (row) {
      const [, slot, time, ping, , state, , rawName] = row
      const name = rawName.trim()
      // 65535 / '' / challenging are connecting or empty slots.
      if (!name || Number(slot) === 65535 || /^challenging$/i.test(state)) continue
      const isLocal = (!!myNameLower && name.toLowerCase() === myNameLower) || undefined
      add({
        key: nameKey(name),
        name,
        ping: Number(ping),
        connectedFor: time,
        state: state.toLowerCase(),
        isLocal
      })
      continue
    }

    if (/\b(active|spawning|connecting)\b/i.test(line) && /['"]/.test(line) && !/\bBOT\b/.test(line)) ignoredLines++
  }

  const list = [...players.values()]
  const hasMarker = STATUS_MARKERS.some((re) => re.test(text))
  const looksLikeStatus = list.length > 0 && (hasMarker || list.length >= 2)

  return {
    players: list,
    ignoredLines,
    rawHash: fingerprint(text),
    looksLikeStatus,
    officialServer: RE_OFFICIAL.test(text),
    map
  }
}

/** Quick check used by the clipboard watcher. */
export function isLikelyStatusOutput(text: string): boolean {
  if (!text || text.length < 20 || text.length > 200_000) return false
  const hasMarker = STATUS_MARKERS.some((re) => re.test(text))
  if (!hasMarker) return false
  return parseStatus(text).players.length > 0
}
