import { describe, expect, it } from 'vitest'
import { fingerprint, isLikelyStatusOutput, parseStatus } from '@shared/lobby-parser'
import { accountIdToSteam64, steam64ToAccountId } from '@shared/steam-id'
import { CS2_STATUS, CSGO_STATUS } from './fixtures'
import { VALVE_STATUS } from './fixtures-valve'

describe('steam-id', () => {
  it('converts account id <-> steam64', () => {
    expect(accountIdToSteam64(1234567)).toBe('76561197961500295')
    expect(steam64ToAccountId('76561197961500295')).toBe(1234567)
    expect(steam64ToAccountId('nope')).toBeUndefined()
  })
})

describe('parseStatus (CS2 layout)', () => {
  const parsed = parseStatus(CS2_STATUS)

  it('extracts every human player once and ignores bots', () => {
    expect(parsed.players).toHaveLength(7)
    expect(parsed.players.map((p) => p.name)).toEqual([
      'DeadInside',
      'aim.exe',
      'pepe with spaces',
      'Nobody',
      'xXProXx',
      "it's quoted",
      'late joiner'
    ])
  })

  it('converts [U:1:X] to steam64 and keeps the account id', () => {
    const aim = parsed.players.find((p) => p.name === 'aim.exe')!
    expect(aim.steamId).toBe('76561197961500295')
    expect(aim.accountId).toBe(1234567)
  })

  it('extracts ping and connection time', () => {
    const aim = parsed.players.find((p) => p.name === 'aim.exe')!
    expect(aim.ping).toBe(61)
    expect(aim.connectedFor).toBe('06:52')
  })

  it('recognises the text as status output', () => {
    expect(parsed.looksLikeStatus).toBe(true)
    expect(isLikelyStatusOutput(CS2_STATUS)).toBe(true)
  })

  it('flags the local player when mySteamId matches', () => {
    const p = parseStatus(CS2_STATUS, { mySteamId: '76561197961500295' })
    expect(p.players.find((x) => x.name === 'aim.exe')?.isLocal).toBe(true)
    expect(p.players.find((x) => x.name === 'Nobody')?.isLocal).toBeFalsy()
  })
})

describe('parseStatus (CS:GO layout)', () => {
  const parsed = parseStatus(CSGO_STATUS)

  it('parses STEAM_1:Y:Z ids and double quoted names', () => {
    expect(parsed.players.map((p) => p.name)).toEqual(['nick one', 'nick \\"two\\"'])
    expect(parsed.players[0].steamId).toBe(accountIdToSteam64(12345 * 2))
    expect(parsed.players[1].steamId).toBe(accountIdToSteam64(67890 * 2 + 1))
  })

  it('removes duplicate ids', () => {
    expect(parsed.players.filter((p) => p.steamId === accountIdToSteam64(24690))).toHaveLength(1)
  })
})

describe('parseStatus edge cases', () => {
  it('handles partial output without header', () => {
    const p = parseStatus(`  1      06:52   61    0     active 786432 [U:1:1234567] 'aim.exe'`)
    expect(p.players).toHaveLength(1)
    // single line without any marker: still parsed, but not confidently status output
    expect(p.looksLikeStatus).toBe(false)
  })

  it('accepts raw steam64 ids', () => {
    const p = parseStatus(`76561197961500295 "someone"\n76561197960265770 'other'`)
    expect(p.players.map((x) => x.steamId)).toEqual(['76561197961500295', '76561197960265770'])
    expect(p.players.map((x) => x.name)).toEqual(['someone', 'other'])
  })

  it('ignores malformed lines and random text', () => {
    const p = parseStatus(`hello world\n[U:1:abc] 'bad'\n\n\n`)
    expect(p.players).toHaveLength(0)
    expect(isLikelyStatusOutput('just some text about players active')).toBe(false)
    expect(isLikelyStatusOutput('')).toBe(false)
  })

  it('treats CRLF like LF', () => {
    const a = parseStatus(CS2_STATUS)
    const b = parseStatus(CS2_STATUS.replace(/\n/g, '\r\n'))
    expect(b.players).toEqual(a.players)
    expect(b.rawHash).toBe(a.rawHash)
  })

  it('fingerprint is stable and differs for different text', () => {
    expect(fingerprint('abc')).toBe(fingerprint('abc  '))
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'))
  })
})

describe('parseStatus (official Valve server, ids hidden)', () => {
  const parsed = parseStatus(VALVE_STATUS, { myName: 'blinky', mySteamId: '76561198973228659' })

  it('extracts all ten humans by name and drops empty / connecting slots', () => {
    expect(parsed.players).toHaveLength(10)
    expect(parsed.players.map((p) => p.name)).toEqual([
      'Ramiirez',
      'Ø',
      'xXZedScoutXx',
      'iTzDMR_17',
      'éogu',
      'Luhhh',
      '3siete',
      '[L J T]ティジペラルタ',
      'tremendo',
      'blinky'
    ])
    for (const p of parsed.players) expect(p.steamId).toBeUndefined()
  })

  it('uses a name key, keeps ping / time / state and detects the official server + map', () => {
    const zed = parsed.players.find((p) => p.name === 'xXZedScoutXx')!
    expect(zed.key).toBe('name:xxzedscoutxx')
    expect(zed.ping).toBe(7)
    expect(zed.connectedFor).toBe('00:10')
    expect(zed.state).toBe('active')
    expect(parsed.players.find((p) => p.name === 'Ramiirez')!.state).toBe('spawning')
    expect(parsed.officialServer).toBe(true)
    expect(parsed.map).toBe('cs_office')
    expect(parsed.looksLikeStatus).toBe(true)
    expect(isLikelyStatusOutput(VALVE_STATUS)).toBe(true)
  })

  it('marks the local player by persona name', () => {
    expect(parsed.players.find((p) => p.name === 'blinky')!.isLocal).toBe(true)
    expect(parsed.players.filter((p) => p.isLocal)).toHaveLength(1)
  })

  it('does not treat the server steamid line as a player', () => {
    expect(parsed.players.some((p) => p.name.includes('A:1:'))).toBe(false)
  })
})
