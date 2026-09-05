import { describe, expect, it } from 'vitest'
import { extractContinueToken, finalizeMatch, modeFromTab, parseMatchHistoryHtml } from '../src/main/services/steam-history-parser'
import { HISTORY_HTML, ME } from './fixtures-history'

describe('steam match history parser', () => {
  const page = parseMatchHistoryHtml(HISTORY_HTML, 'competitive')

  it('finds every match with metadata', () => {
    expect(page.matches).toHaveLength(2)
    const m = page.matches[0]
    expect(m.matchId).toBe('003742811223344556677_1234567890')
    expect(m.map).toBe('Office')
    expect(m.playedAt).toBe('2026-09-05T18:40:30Z')
    expect(m.waitSeconds).toBe(20)
    expect(m.durationSeconds).toBe(30 * 60 + 40)
    expect(m.topScore).toBe(13)
    expect(m.bottomScore).toBe(9)
    expect(page.continueToken).toBe('AAAABBBB1234')
    expect(extractContinueToken('nothing here')).toBeUndefined()
  })

  it('parses players, sides and stats, keeping vanity urls unresolved', () => {
    const m = page.matches[0]
    expect(m.players).toHaveLength(10)
    const ram = m.players[0]
    expect(ram).toMatchObject({ steamId: '76561198000000001', name: 'Ramiirez', side: 0 })
    expect(ram.stats).toEqual({ ping: 45, kills: 21, assists: 5, deaths: 14, mvps: 2, headshotPercentage: 55, score: 50 })
    expect(ram.avatarUrl).toContain('76561198000000001.jpg')
    const vanity = m.players.find((p) => p.name.startsWith('[L J T]'))!
    expect(vanity.steamId).toBeUndefined()
    expect(vanity.vanity).toBe('custom_vanity')
    expect(vanity.side).toBe(1)
    expect(m.players.filter((p) => p.side === 0)).toHaveLength(5)
  })

  it('falls back to a synthetic id when there is no GOTV link', () => {
    expect(page.matches[1].matchId).toMatch(/^h_[0-9a-f]+$/)
  })

  it('finalizeMatch assigns teams and result relative to me', () => {
    const m = finalizeMatch(page.matches[0], ME)
    // the vanity player is dropped until resolved
    expect(m.players).toHaveLength(9)
    expect(m.players.find((p) => p.steamId === ME)?.team).toBe('mine')
    expect(m.players.find((p) => p.name === 'Ramiirez')?.team).toBe('enemy')
    expect(m.players.find((p) => p.name === 'Luhhh')?.team).toBe('mine')
    expect(m.myScore).toBe(9)
    expect(m.theirScore).toBe(13)
    expect(m.result).toBe('loss')

    const tie = finalizeMatch(page.matches[1], ME)
    expect(tie.result).toBe('tie')
    expect(tie.players.find((p) => p.name === 'foe')?.team).toBe('enemy')
  })

  it('finalizeMatch without knowing who I am keeps a top/bottom split', () => {
    const m = finalizeMatch(page.matches[0], undefined)
    expect(m.result).toBe('unknown')
    expect(new Set(m.players.map((p) => p.team)).size).toBe(2)
  })

  it('maps tabs to modes', () => {
    expect(modeFromTab('matchhistorypremier')).toBe('premier')
    expect(modeFromTab('matchhistorycompetitive')).toBe('competitive')
    expect(modeFromTab('matchhistorywingman')).toBe('wingman')
  })
})
