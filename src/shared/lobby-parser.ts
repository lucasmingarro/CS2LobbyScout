import type { LobbyPlayer, ParsedLobby } from './types'
import { accountIdToSteam64, isSteam64, steam2ToAccountId, steam64ToAccountId } from './steam-id'

/**
 * Parser for the CS2 console `status` command.
 *
 * The exact layout of `status` has changed across CS:GO / CS2 builds, so this
 * parser is deliberately tolerant: for every line it looks for *any* Steam
 * identifier ([U:1:X], STEAM_1:Y:Z or a raw Steam64) and then extracts the
 * quoted player name from the same line. Lines without an identifier (bots,
 * header lines, spawngroups, ...) are ignored.
 *
 * Known layouts:
 *
 *   CS2:
 *     id     time ping loss      state   rate adr name
 *     0      06:53   35    0     active 786432 [U:1:123456789] 'nickname'
 *
 *   CS:GO (legacy, still accepted):
 *     # userid name uniqueid connected ping loss state rate
 *     #  3 1 "nickname" STEAM_1:0:12345 05:23 61 0 active 196608
 */

const RE_STEAM3 = /\[U:1:(\d{1,10})\]/
const RE_STEAM2 = /STEAM_[0-5]:([01]):(\d{1,10})/
const RE_STEAM64 = /(?<![\d])(7656119\d{10})(?![\d])/
const RE_TIME = /(?:^|\s)(\d{1,3}:\d{2}(?::\d{2})?)(?=\s)/
const RE_LOCAL_HINT = /\bloopback\b/i

const STATUS_MARKERS = [
  /---------players--------/i,
  /^\s*#\s*userid\s+name\s+uniqueid/im,
  /^\s*id\s+time\s+ping\s+loss\s+state/im,
  /^\s*#end\s*$/im,
  /^\s*Server:\s/im,
  /^\s*Client:\s/im,
  /^\s*players\s*:\s*\d+\s+humans/im
]

interface IdMatch {
  steamId: string
  accountId?: number
  start: number
  end: number
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

/**
 * Extracts the quoted name from a status line. CS2 prints the name *after* the
 * id in single quotes; CS:GO printed it *before* the id in double quotes. We
 * try the segment after the id first, then the whole line, greedy so that
 * names containing quotes survive.
 */
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
  // Fallback: last non-numeric token in the line that is not the id itself.
  const tokens = (after.trim() || before.trim()).split(/\s+/).filter(Boolean)
  const tok = tokens.reverse().find((t) => !/^[\d:.]+$/.test(t) && !/^(active|spawning|connecting|challenging)$/i.test(t))
  return tok
}

function extractPing(line: string, id: IdMatch): { ping?: number; connectedFor?: string } {
  // Look at the part of the line that is not the name to avoid picking numbers from nicknames.
  const stripped = line.replace(/'(.*)'/, ' ').replace(/"(.*)"/, ' ')
  const timeMatch = RE_TIME.exec(stripped)
  if (!timeMatch) return {}
  const rest = stripped.slice(timeMatch.index + timeMatch[0].length).trim()
  const pingTok = rest.split(/\s+/)[0]
  const ping = pingTok && /^\d{1,4}$/.test(pingTok) ? Number(pingTok) : undefined
  void id
  return { ping, connectedFor: timeMatch[1] }
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
  /** Steam64 of the local user, used to flag `isLocal`. */
  mySteamId?: string
}

export function parseStatus(raw: string, options: ParseOptions = {}): ParsedLobby {
  const text = (raw ?? '').replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  const byId = new Map<string, LobbyPlayer>()
  let ignoredLines = 0

  for (const line of lines) {
    if (!line.trim()) continue
    const id = findSteamId(line)
    if (!id) {
      // Lines that look like player rows (contain 'active'/'spawning' or a quoted name) but have no id.
      if (/\b(active|spawning|connecting)\b/i.test(line) && /['"]/.test(line) && !/\bBOT\b/.test(line)) ignoredLines++
      continue
    }
    const name = extractName(line, id)
    if (!name) {
      ignoredLines++
      continue
    }
    const { ping, connectedFor } = extractPing(line, id)
    const isLocal = (options.mySteamId && options.mySteamId === id.steamId) || RE_LOCAL_HINT.test(line) || undefined

    const existing = byId.get(id.steamId)
    if (existing) {
      // Duplicate id: keep first, but fill missing fields.
      existing.ping ??= ping
      existing.connectedFor ??= connectedFor
      existing.isLocal ||= isLocal
      continue
    }
    byId.set(id.steamId, {
      steamId: id.steamId,
      accountId: id.accountId,
      name,
      ping,
      connectedFor,
      isLocal
    })
  }

  const players = [...byId.values()]
  const hasMarker = STATUS_MARKERS.some((re) => re.test(text))
  const looksLikeStatus = players.length > 0 && (hasMarker || players.length >= 2)

  return { players, ignoredLines, rawHash: fingerprint(text), looksLikeStatus }
}

/** Quick check used by the clipboard watcher. */
export function isLikelyStatusOutput(text: string): boolean {
  if (!text || text.length < 20 || text.length > 200_000) return false
  const hasMarker = STATUS_MARKERS.some((re) => re.test(text))
  if (!hasMarker) return false
  return parseStatus(text).players.length > 0
}
