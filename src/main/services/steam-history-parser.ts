import * as cheerio from 'cheerio'
import type { ImportedMatch, ImportedMatchPlayer, MatchMode, Team } from '@shared/types'

/**
 * Parser for the "Personal Game Data" match history pages on steamcommunity.com
 * (https://steamcommunity.com/my/gcpd/730?tab=matchhistorycompetitive).
 *
 * Each match is one row of `table.csgo_scoreboard_root`: a left cell with
 * mode / map / date / wait time / duration (+ optional GOTV link) and a right
 * cell with the scoreboard: header, 5 players, a "13 : 9" score row, 5 players.
 * Player links are either /profiles/<steam64> or /id/<vanity>; vanity urls are
 * returned unresolved in `vanityPlayers` so the caller can resolve them.
 */

export interface RawMatchPlayer extends Omit<ImportedMatchPlayer, 'steamId'> {
  steamId?: string
  vanity?: string
  /** 0 = top half of the scoreboard, 1 = bottom half. */
  side: 0 | 1
}

export interface RawMatch extends Omit<ImportedMatch, 'players' | 'myScore' | 'theirScore' | 'result'> {
  topScore?: number
  bottomScore?: number
  players: RawMatchPlayer[]
}

export interface ParsedHistoryPage {
  matches: RawMatch[]
  continueToken?: string
}

const RE_DATE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/
const RE_SCORE = /^\s*(\d+)\s*:\s*(\d+)\s*$/
const RE_PROFILE = /steamcommunity\.com\/profiles\/(\d{17})/
const RE_VANITY = /steamcommunity\.com\/id\/([^/?#\s]+)/
const RE_GOTV = /\/730\/(\d+)_(\d+)\.dem/
const RE_MMSS = /(\d+):(\d{2})/

function toSeconds(text: string): number | undefined {
  const m = RE_MMSS.exec(text)
  if (!m) return undefined
  return Number(m[1]) * 60 + Number(m[2])
}

function num(text: string): number {
  const m = /-?\d+(\.\d+)?/.exec(text.replace(/,/g, ''))
  return m ? Number(m[0]) : 0
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function modeFromTab(tab: string): MatchMode {
  if (tab.includes('premier')) return 'premier'
  if (tab.includes('competitive')) return 'competitive'
  if (tab.includes('wingman')) return 'wingman'
  return 'other'
}

export function extractContinueToken(html: string): string | undefined {
  const m = /g_sGcContinueToken\s*=\s*["']([^"']+)["']/.exec(html)
  return m?.[1]
}

export function parseMatchHistoryHtml(html: string, mode: MatchMode): ParsedHistoryPage {
  const $ = cheerio.load(html)
  const matches: RawMatch[] = []

  $('table.csgo_scoreboard_root > tbody > tr, table.csgo_scoreboard_root > tr').each((_, row) => {
    const $row = $(row)
    const left = $row.find('table.csgo_scoreboard_inner_left').first()
    const right = $row.find('table.csgo_scoreboard_inner_right').first()
    if (right.length === 0) return

    // ---- left column ------------------------------------------------------
    const lines = left
      .find('td')
      .toArray()
      .map((td) => clean($(td).text()))
      .filter(Boolean)
    let playedAt: string | undefined
    let map: string | undefined
    let durationSeconds: number | undefined
    let waitSeconds: number | undefined
    const skip = /^(competitive|premier|wingman|casual|deathmatch|scrimmage|download gotv replay)$/i
    for (const line of lines) {
      const d = RE_DATE.exec(line)
      if (d) {
        playedAt = `${d[1]}T${d[2]}Z`
        continue
      }
      if (/^wait time/i.test(line)) {
        waitSeconds = toSeconds(line)
        continue
      }
      if (/^match duration/i.test(line)) {
        durationSeconds = toSeconds(line)
        continue
      }
      if (skip.test(line)) continue
      if (!map && !/replay/i.test(line)) map = line
    }
    let matchId: string | undefined
    const gotv = left.find('a[href*=".dem"]').attr('href') ?? $row.find('a[href*=".dem"]').attr('href')
    if (gotv) {
      const g = RE_GOTV.exec(gotv)
      if (g) matchId = `${g[1]}_${g[2]}`
    }

    // ---- right column: scoreboard ------------------------------------------
    const players: RawMatchPlayer[] = []
    let topScore: number | undefined
    let bottomScore: number | undefined
    let side: 0 | 1 = 0
    right.find('tr').each((_, tr) => {
      const $tr = $(tr)
      const text = clean($tr.text())
      const score = RE_SCORE.exec(text)
      if (score && $tr.find('a').length === 0) {
        topScore = Number(score[1])
        bottomScore = Number(score[2])
        side = 1
        return
      }
      const link = $tr.find('a[href*="steamcommunity.com/"]').first().attr('href') ?? ''
      const prof = RE_PROFILE.exec(link)
      const van = RE_VANITY.exec(link)
      const nameCell = $tr.find('td.inner_name').first()
      if (!prof && !van && nameCell.length === 0) return // header
      const name =
        clean(nameCell.find('.linkTitle').first().text()) ||
        clean($tr.find('a[href*="steamcommunity.com/"]').last().text()) ||
        clean(nameCell.text())
      const avatarUrl = $tr.find('img').first().attr('src') || undefined
      // numeric cells follow the name cell: ping, K, A, D, MVP, HSP, Score
      const cells = $tr
        .find('td')
        .toArray()
        .filter((td) => !$(td).hasClass('inner_name') && $(td).find('a[href*="steamcommunity.com/"]').length === 0)
        .map((td) => clean($(td).text()))
      const [ping = '', k = '', a = '', d = '', mvp = '', hsp = '', sc = ''] = cells
      players.push({
        steamId: prof?.[1],
        vanity: van?.[1],
        name,
        avatarUrl,
        team: 'unknown' as Team,
        side,
        stats: {
          ping: ping ? num(ping) : undefined,
          kills: num(k),
          assists: num(a),
          deaths: num(d),
          mvps: /\d/.test(mvp) ? num(mvp) : mvp.includes('★') ? 1 : 0,
          headshotPercentage: hsp ? num(hsp) : undefined,
          score: num(sc)
        }
      })
    })

    if (players.length === 0 || !playedAt) return
    if (!matchId) {
      const ids = players.map((p) => p.steamId ?? p.vanity ?? p.name).sort().join(',')
      matchId = `h_${simpleHash(`${playedAt}|${ids}`)}`
    }
    matches.push({ matchId, mode, map, playedAt, durationSeconds, waitSeconds, topScore, bottomScore, players })
  })

  return { matches, continueToken: extractContinueToken(html) }
}

function simpleHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16)
}

/** Assigns teams / result relative to the local user and drops unresolved players. */
export function finalizeMatch(raw: RawMatch, mySteamId: string | undefined): ImportedMatch {
  const resolved = raw.players.filter((p): p is RawMatchPlayer & { steamId: string } => !!p.steamId)
  const me = mySteamId ? resolved.find((p) => p.steamId === mySteamId) : undefined
  const mySide = me?.side
  const players: ImportedMatchPlayer[] = resolved.map((p) => ({
    steamId: p.steamId,
    name: p.name,
    avatarUrl: p.avatarUrl,
    team: mySide === undefined ? (p.side === 0 ? 'enemy' : 'mine') : p.side === mySide ? 'mine' : 'enemy',
    stats: p.stats
  }))
  let myScore = raw.topScore
  let theirScore = raw.bottomScore
  if (mySide === 1) [myScore, theirScore] = [raw.bottomScore, raw.topScore]
  let result: ImportedMatch['result'] = 'unknown'
  if (mySide !== undefined && myScore !== undefined && theirScore !== undefined) {
    result = myScore > theirScore ? 'win' : myScore < theirScore ? 'loss' : 'tie'
  }
  return {
    matchId: raw.matchId,
    mode: raw.mode,
    map: raw.map,
    playedAt: raw.playedAt,
    durationSeconds: raw.durationSeconds,
    waitSeconds: raw.waitSeconds,
    myScore,
    theirScore,
    result,
    players
  }
}
