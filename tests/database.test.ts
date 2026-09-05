import { describe, expect, it, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../src/main/db/database'
import { Repositories } from '../src/main/db/repositories'
import { computeScore } from '@shared/scout-engine'

let db: Db
let repos: Repositories

beforeEach(() => {
  db = openDatabase(':memory:')
  repos = new Repositories(db)
})

describe('Repositories', () => {
  it('migrates to the current schema', () => {
    const version = db.pragma('user_version', { simple: true })
    expect(version).toBeGreaterThanOrEqual(1)
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>).map((t) => t.name)
    expect(tables).toEqual(
      expect.arrayContaining(['players', 'steam_snapshots', 'faceit_snapshots', 'scout_scores', 'encounters', 'match_sessions', 'api_cache', 'ban_events'])
    )
  })

  it('tracks sightings and history', () => {
    repos.upsertPlayerSeen('76561197961500295', 'aim.exe', undefined, true)
    repos.upsertPlayerSeen('76561197961500295', 'aim.exe renamed', 'http://a', true)
    repos.upsertPlayerSeen('76561197961500295', 'aim.exe renamed', undefined, false)
    const h = repos.history('76561197961500295')
    expect(h.timesSeen).toBe(2)
    expect(h.firstSeen).toBeDefined()
    expect(repos.counts().players).toBe(1)
  })

  it('stores encounters per session with team updates', () => {
    const id = repos.createSession('paste', 'abc')
    repos.upsertPlayerSeen('1', 'a', undefined, true)
    repos.addEncounter(id, '1', 'unknown')
    repos.setEncounterTeam(id, '1', 'enemy')
    const full = repos.fullHistory('1')!
    expect(full.encounters).toHaveLength(1)
    expect(full.encounters[0].team).toBe('enemy')
    expect(repos.counts().sessions).toBe(1)
  })

  it('persists snapshots and scores', () => {
    repos.upsertPlayerSeen('1', 'a', undefined, true)
    repos.insertSteamSnapshot('1', { profilePrivate: false, vacBans: 0, gameBans: 0, accountCreatedAt: '2020-01-01T00:00:00Z' })
    repos.insertFaceitSnapshot('1', { level: 4, elo: 1180, matches: 91, kd: 1.82, adr: 116, headshotPercentage: 74, winRate: 68 })
    const score = computeScore({ faceit: { matches: 91, kd: 1.82, adr: 116, headshotPercentage: 74, winRate: 68 } })
    repos.insertScoutScore('1', 1, score)
    const full = repos.fullHistory('1')!
    expect(full.steamSnapshots).toHaveLength(1)
    expect(full.faceitSnapshots[0].elo).toBe(1180)
    expect(full.scores[0].score).toBe(score.score)
    expect(repos.latestScore('1')?.score).toBe(score.score)
    expect(repos.latestSteamSnapshot('1')).toMatchObject({ vacBans: 0, gameBans: 0 })
  })

  it('watch / unwatch and listWatched', () => {
    repos.setWatched('1', true, 'aim.exe')
    expect(repos.isWatched('1')).toBe(true)
    expect(repos.watchedSteamIds()).toEqual(['1'])
    repos.insertSteamSnapshot('1', { vacBans: 0, gameBans: 1 })
    const rows = repos.listWatched()
    expect(rows).toHaveLength(1)
    expect(rows[0].banState).toBe('game')
    repos.setWatched('1', false)
    expect(repos.listWatched()).toHaveLength(0)
  })

  it('records ban events', () => {
    repos.setWatched('1', true, 'xXProXx')
    const e = repos.insertBanEvent({ steamId: '1', previousVacBans: 0, previousGameBans: 0, vacBans: 0, gameBans: 1, scoreWhenSeen: 91 })
    expect(e.name).toBe('xXProXx')
    expect(e.acknowledged).toBe(false)
    expect(repos.listBanEvents(true)).toHaveLength(1)
    repos.acknowledgeBanEvent(e.id)
    expect(repos.listBanEvents(true)).toHaveLength(0)
    expect(repos.listBanEvents(false)).toHaveLength(1)
  })

  it('cache honours ttl and prefix deletion', () => {
    repos.cacheSet('steam:summary:1', { a: 1 }, 60_000)
    repos.cacheSet('faceit:profile:1', { b: 2 }, -1)
    expect(repos.cacheGet('steam:summary:1')).toEqual({ a: 1 })
    expect(repos.cacheGet('faceit:profile:1')).toBeUndefined()
    repos.cachePurgeExpired()
    expect(repos.counts().cache).toBe(1)
    repos.cacheDeleteByPrefix('steam:')
    expect(repos.counts().cache).toBe(0)
  })

  it('clearHistory keeps the cache', () => {
    repos.upsertPlayerSeen('1', 'a', undefined, true)
    repos.cacheSet('k', 1, 60_000)
    repos.clearHistory()
    expect(repos.counts()).toMatchObject({ players: 0, sessions: 0, cache: 1 })
  })
})
