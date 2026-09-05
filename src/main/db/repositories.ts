import type {
  BanEvent,
  FaceitInfo,
  HistoryInfo,
  ImportedMatch,
  ImportedMatchPlayer,
  MatchMode,
  MatchSummary,
  PlayerHistory,
  ScoutResult,
  SteamInfo,
  Team,
  WatchedPlayerRow
} from '@shared/types'
import type { Db } from './database'

const nowIso = (): string => new Date().toISOString()

interface PlayerRow {
  steam_id: string
  current_name: string
  avatar_url: string | null
  first_seen: string
  last_seen: string
  times_seen: number
  watched: number
  watched_at: string | null
}

interface SteamSnapshotRow {
  captured_at: string
  profile_visibility: string | null
  account_created_at: string | null
  cs2_hours: number | null
  vac_bans: number
  game_bans: number
  days_since_last_ban: number | null
}

interface FaceitSnapshotRow {
  captured_at: string
  faceit_id: string | null
  nickname: string | null
  level: number | null
  elo: number | null
  matches: number | null
  kd: number | null
  adr: number | null
  headshot_percentage: number | null
  win_rate: number | null
}

export class Repositories {
  constructor(private db: Db) {}

  // ---- players -----------------------------------------------------------------

  /** Registers a sighting. When `countEncounter` is false only name/avatar are refreshed. */
  upsertPlayerSeen(steamId: string, name: string, avatarUrl: string | undefined, countEncounter: boolean): void {
    const ts = nowIso()
    const existing = this.getPlayerRow(steamId)
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO players (steam_id, current_name, avatar_url, first_seen, last_seen, times_seen, watched, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(steamId, name, avatarUrl ?? null, ts, ts, countEncounter ? 1 : 0, ts, ts)
      return
    }
    this.db
      .prepare(
        `UPDATE players SET current_name = ?, avatar_url = COALESCE(?, avatar_url), last_seen = ?,
           times_seen = times_seen + ?, updated_at = ? WHERE steam_id = ?`
      )
      .run(name, avatarUrl ?? null, ts, countEncounter ? 1 : 0, ts, steamId)
  }

  updatePlayerIdentity(steamId: string, name?: string, avatarUrl?: string): void {
    if (!name && !avatarUrl) return
    this.db
      .prepare(
        `UPDATE players SET current_name = COALESCE(?, current_name), avatar_url = COALESCE(?, avatar_url), updated_at = ?
         WHERE steam_id = ?`
      )
      .run(name ?? null, avatarUrl ?? null, nowIso(), steamId)
  }

  private getPlayerRow(steamId: string): PlayerRow | undefined {
    return this.db.prepare(`SELECT * FROM players WHERE steam_id = ?`).get(steamId) as PlayerRow | undefined
  }

  isWatched(steamId: string): boolean {
    return !!this.getPlayerRow(steamId)?.watched
  }

  setWatched(steamId: string, watched: boolean, fallbackName = 'unknown'): void {
    const ts = nowIso()
    if (!this.getPlayerRow(steamId)) {
      this.db
        .prepare(
          `INSERT INTO players (steam_id, current_name, first_seen, last_seen, times_seen, watched, watched_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`
        )
        .run(steamId, fallbackName, ts, ts, watched ? 1 : 0, watched ? ts : null, ts, ts)
      return
    }
    this.db
      .prepare(`UPDATE players SET watched = ?, watched_at = ?, updated_at = ? WHERE steam_id = ?`)
      .run(watched ? 1 : 0, watched ? ts : null, ts, steamId)
  }

  history(steamId: string): HistoryInfo {
    const p = this.getPlayerRow(steamId)
    const scores = this.db
      .prepare(`SELECT score, captured_at FROM scout_scores WHERE steam_id = ? ORDER BY captured_at DESC LIMIT 20`)
      .all(steamId) as Array<{ score: number; captured_at: string }>
    return {
      firstSeen: p?.first_seen,
      lastSeen: p?.last_seen,
      timesSeen: p?.times_seen ?? 0,
      previousScores: scores.map((s) => ({ score: s.score, capturedAt: s.captured_at }))
    }
  }

  fullHistory(steamId: string): PlayerHistory | undefined {
    const p = this.getPlayerRow(steamId)
    if (!p) return undefined
    const encounters = this.db
      .prepare(
        `SELECT encountered_at, team, match_session_id FROM encounters WHERE steam_id = ? ORDER BY encountered_at DESC LIMIT 100`
      )
      .all(steamId) as Array<{ encountered_at: string; team: Team; match_session_id: number }>
    const scores = this.db
      .prepare(`SELECT score, captured_at FROM scout_scores WHERE steam_id = ? ORDER BY captured_at DESC LIMIT 100`)
      .all(steamId) as Array<{ score: number; captured_at: string }>
    const steam = this.db
      .prepare(`SELECT * FROM steam_snapshots WHERE steam_id = ? ORDER BY captured_at DESC LIMIT 50`)
      .all(steamId) as SteamSnapshotRow[]
    const faceit = this.db
      .prepare(`SELECT * FROM faceit_snapshots WHERE steam_id = ? ORDER BY captured_at DESC LIMIT 50`)
      .all(steamId) as FaceitSnapshotRow[]
    return {
      steamId,
      name: p.current_name,
      encounters: encounters.map((e) => ({ encounteredAt: e.encountered_at, team: e.team, sessionId: e.match_session_id })),
      scores: scores.map((s) => ({ score: s.score, capturedAt: s.captured_at })),
      steamSnapshots: steam.map((s) => ({
        capturedAt: s.captured_at,
        vacBans: s.vac_bans,
        gameBans: s.game_bans,
        profilePrivate: s.profile_visibility === 'private'
      })),
      faceitSnapshots: faceit.map((f) => ({
        capturedAt: f.captured_at,
        level: f.level ?? undefined,
        elo: f.elo ?? undefined,
        matches: f.matches ?? undefined,
        kd: f.kd ?? undefined,
        adr: f.adr ?? undefined,
        headshotPercentage: f.headshot_percentage ?? undefined,
        winRate: f.win_rate ?? undefined
      }))
    }
  }

  // ---- snapshots ---------------------------------------------------------------

  insertSteamSnapshot(steamId: string, s: SteamInfo): void {
    this.db
      .prepare(
        `INSERT INTO steam_snapshots (steam_id, profile_visibility, account_created_at, cs2_hours, vac_bans, game_bans, days_since_last_ban, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        steamId,
        s.profilePrivate === undefined ? null : s.profilePrivate ? 'private' : 'public',
        s.accountCreatedAt ?? null,
        s.cs2Hours ?? null,
        s.vacBans ?? 0,
        s.gameBans ?? 0,
        s.daysSinceLastBan ?? null,
        nowIso()
      )
  }

  latestSteamSnapshot(steamId: string): { vacBans: number; gameBans: number; capturedAt: string } | undefined {
    const row = this.db
      .prepare(`SELECT vac_bans, game_bans, captured_at FROM steam_snapshots WHERE steam_id = ? ORDER BY captured_at DESC LIMIT 1`)
      .get(steamId) as { vac_bans: number; game_bans: number; captured_at: string } | undefined
    return row ? { vacBans: row.vac_bans, gameBans: row.game_bans, capturedAt: row.captured_at } : undefined
  }

  insertFaceitSnapshot(steamId: string, f: FaceitInfo): void {
    this.db
      .prepare(
        `INSERT INTO faceit_snapshots (steam_id, faceit_id, nickname, level, elo, matches, kd, adr, headshot_percentage, win_rate, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        steamId,
        f.playerId ?? null,
        f.nickname ?? null,
        f.level ?? null,
        f.elo ?? null,
        f.matches ?? null,
        f.kd ?? null,
        f.adr ?? null,
        f.headshotPercentage ?? null,
        f.winRate ?? null,
        nowIso()
      )
  }

  insertScoutScore(steamId: string, engineVersion: number, r: ScoutResult): void {
    const c = r.components
    this.db
      .prepare(
        `INSERT INTO scout_scores (steam_id, engine_version, score, kd_score, adr_score, hs_score, account_age_score,
           match_count_score, win_rate_score, performance_jump_score, signals_json, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        steamId,
        engineVersion,
        r.score,
        c.kd,
        c.adr,
        c.hs,
        c.accountAge,
        c.matchCount,
        c.winRate,
        c.performanceJump,
        JSON.stringify(r.signals),
        nowIso()
      )
  }

  latestScore(steamId: string): { score: number; capturedAt: string } | undefined {
    const row = this.db
      .prepare(`SELECT score, captured_at FROM scout_scores WHERE steam_id = ? ORDER BY captured_at DESC LIMIT 1`)
      .get(steamId) as { score: number; captured_at: string } | undefined
    return row ? { score: row.score, capturedAt: row.captured_at } : undefined
  }

  firstScore(steamId: string): number | undefined {
    const row = this.db
      .prepare(`SELECT score FROM scout_scores WHERE steam_id = ? ORDER BY captured_at ASC LIMIT 1`)
      .get(steamId) as { score: number } | undefined
    return row?.score
  }

  // ---- sessions / encounters ---------------------------------------------------

  createSession(source: string, rawHash: string, raw?: string): number {
    const res = this.db
      .prepare(`INSERT INTO match_sessions (created_at, source, raw_status_hash, raw_status) VALUES (?, ?, ?, ?)`)
      .run(nowIso(), source, rawHash, raw ?? null)
    return Number(res.lastInsertRowid)
  }

  addEncounter(sessionId: number, steamId: string, team: Team): void {
    this.db
      .prepare(
        `INSERT INTO encounters (match_session_id, steam_id, team, encountered_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(match_session_id, steam_id) DO UPDATE SET team = excluded.team`
      )
      .run(sessionId, steamId, team, nowIso())
  }

  setEncounterTeam(sessionId: number, steamId: string, team: Team): void {
    this.db.prepare(`UPDATE encounters SET team = ? WHERE match_session_id = ? AND steam_id = ?`).run(team, sessionId, steamId)
  }

  // ---- cache -------------------------------------------------------------------

  cacheGet<T>(key: string): T | undefined {
    const row = this.db.prepare(`SELECT payload, expires_at FROM api_cache WHERE cache_key = ?`).get(key) as
      | { payload: string; expires_at: string }
      | undefined
    if (!row) return undefined
    if (Date.parse(row.expires_at) <= Date.now()) return undefined
    try {
      return JSON.parse(row.payload) as T
    } catch {
      return undefined
    }
  }

  cacheSet(key: string, payload: unknown, ttlMs: number): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO api_cache (cache_key, payload, fetched_at, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`
      )
      .run(key, JSON.stringify(payload), new Date(now).toISOString(), new Date(now + ttlMs).toISOString())
  }

  cacheDeleteByPrefix(prefix: string): void {
    this.db.prepare(`DELETE FROM api_cache WHERE cache_key LIKE ?`).run(`${prefix}%`)
  }

  cacheClear(): void {
    this.db.prepare(`DELETE FROM api_cache`).run()
  }

  cachePurgeExpired(): void {
    this.db.prepare(`DELETE FROM api_cache WHERE expires_at <= ?`).run(nowIso())
  }

  // ---- watched / bans ----------------------------------------------------------

  listWatched(): WatchedPlayerRow[] {
    const rows = this.db
      .prepare(
        `SELECT p.steam_id, p.current_name, p.avatar_url, p.first_seen, p.last_seen, p.times_seen,
                (SELECT score FROM scout_scores s WHERE s.steam_id = p.steam_id ORDER BY captured_at DESC LIMIT 1) AS last_score,
                (SELECT captured_at FROM scout_scores s WHERE s.steam_id = p.steam_id ORDER BY captured_at DESC LIMIT 1) AS last_score_at,
                (SELECT vac_bans FROM steam_snapshots ss WHERE ss.steam_id = p.steam_id ORDER BY captured_at DESC LIMIT 1) AS vac_bans,
                (SELECT game_bans FROM steam_snapshots ss WHERE ss.steam_id = p.steam_id ORDER BY captured_at DESC LIMIT 1) AS game_bans,
                (SELECT detected_at FROM ban_events b WHERE b.steam_id = p.steam_id ORDER BY detected_at DESC LIMIT 1) AS ban_detected_at
         FROM players p WHERE p.watched = 1 ORDER BY p.last_seen DESC`
      )
      .all() as Array<{
      steam_id: string
      current_name: string
      avatar_url: string | null
      first_seen: string
      last_seen: string
      times_seen: number
      last_score: number | null
      last_score_at: string | null
      vac_bans: number | null
      game_bans: number | null
      ban_detected_at: string | null
    }>
    return rows.map((r) => {
      const vac = r.vac_bans ?? 0
      const game = r.game_bans ?? 0
      return {
        steamId: r.steam_id,
        name: r.current_name,
        avatarUrl: r.avatar_url ?? undefined,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
        timesSeen: r.times_seen,
        lastScore: r.last_score ?? undefined,
        lastScoreAt: r.last_score_at ?? undefined,
        vacBans: vac,
        gameBans: game,
        banState: vac > 0 && game > 0 ? 'both' : vac > 0 ? 'vac' : game > 0 ? 'game' : 'none',
        banDetectedAt: r.ban_detected_at ?? undefined
      }
    })
  }

  watchedSteamIds(): string[] {
    return (this.db.prepare(`SELECT steam_id FROM players WHERE watched = 1`).all() as Array<{ steam_id: string }>).map(
      (r) => r.steam_id
    )
  }

  insertBanEvent(e: Omit<BanEvent, 'id' | 'name' | 'firstSeen' | 'acknowledged' | 'detectedAt'>): BanEvent {
    const ts = nowIso()
    const res = this.db
      .prepare(
        `INSERT INTO ban_events (steam_id, previous_vac_bans, previous_game_bans, vac_bans, game_bans, score_when_seen, detected_at, acknowledged)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(e.steamId, e.previousVacBans, e.previousGameBans, e.vacBans, e.gameBans, e.scoreWhenSeen ?? null, ts)
    return this.listBanEvents().find((b) => b.id === Number(res.lastInsertRowid))!
  }

  listBanEvents(onlyUnacknowledged = false): BanEvent[] {
    const rows = this.db
      .prepare(
        `SELECT b.*, p.current_name, p.first_seen FROM ban_events b JOIN players p ON p.steam_id = b.steam_id
         ${onlyUnacknowledged ? 'WHERE b.acknowledged = 0' : ''} ORDER BY b.detected_at DESC LIMIT 200`
      )
      .all() as Array<{
      id: number
      steam_id: string
      previous_vac_bans: number
      previous_game_bans: number
      vac_bans: number
      game_bans: number
      score_when_seen: number | null
      detected_at: string
      acknowledged: number
      current_name: string
      first_seen: string
    }>
    return rows.map((r) => ({
      id: r.id,
      steamId: r.steam_id,
      name: r.current_name,
      previousVacBans: r.previous_vac_bans,
      previousGameBans: r.previous_game_bans,
      vacBans: r.vac_bans,
      gameBans: r.game_bans,
      firstSeen: r.first_seen,
      scoreWhenSeen: r.score_when_seen ?? undefined,
      detectedAt: r.detected_at,
      acknowledged: !!r.acknowledged
    }))
  }

  acknowledgeBanEvent(id: number): void {
    this.db.prepare(`UPDATE ban_events SET acknowledged = 1 WHERE id = ?`).run(id)
  }

  // ---- imported matches --------------------------------------------------------

  hasMatch(matchId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM matches WHERE match_id = ?`).get(matchId)
  }

  /** Stores a match and its players; also registers each player as seen. Returns false if it already existed. */
  insertMatch(m: ImportedMatch, countEncounters: boolean): boolean {
    if (this.hasMatch(m.matchId)) return false
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO matches (match_id, mode, map, played_at, duration_seconds, wait_seconds, my_score, their_score, result, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(m.matchId, m.mode, m.map ?? null, m.playedAt, m.durationSeconds ?? null, m.waitSeconds ?? null, m.myScore ?? null, m.theirScore ?? null, m.result ?? null, nowIso())
      const ins = this.db.prepare(
        `INSERT OR REPLACE INTO match_players (match_id, steam_id, name, team, kills, assists, deaths, mvps, headshot_percentage, score, ping)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const p of m.players) {
        ins.run(m.matchId, p.steamId, p.name, p.team, p.stats.kills, p.stats.assists, p.stats.deaths, p.stats.mvps, p.stats.headshotPercentage ?? null, p.stats.score, p.stats.ping ?? null)
        this.upsertPlayerSeen(p.steamId, p.name, p.avatarUrl, countEncounters)
      }
      if (countEncounters) {
        const sessionId = this.createSession('steam_history', m.matchId)
        for (const p of m.players) {
          this.db
            .prepare(`INSERT INTO encounters (match_session_id, steam_id, team, encountered_at) VALUES (?, ?, ?, ?) ON CONFLICT(match_session_id, steam_id) DO UPDATE SET team = excluded.team`)
            .run(sessionId, p.steamId, p.team, m.playedAt)
        }
      }
    })
    run()
    return true
  }

  listMatches(limit = 100): MatchSummary[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, (SELECT COUNT(*) FROM match_players mp WHERE mp.match_id = m.match_id) AS player_count
         FROM matches m ORDER BY played_at DESC LIMIT ?`
      )
      .all(limit) as Array<{
      match_id: string
      mode: MatchMode
      map: string | null
      played_at: string
      duration_seconds: number | null
      my_score: number | null
      their_score: number | null
      result: string | null
      player_count: number
    }>
    return rows.map((r) => ({
      matchId: r.match_id,
      mode: r.mode,
      map: r.map ?? undefined,
      playedAt: r.played_at,
      durationSeconds: r.duration_seconds ?? undefined,
      myScore: r.my_score ?? undefined,
      theirScore: r.their_score ?? undefined,
      result: (r.result as MatchSummary['result']) ?? undefined,
      playerCount: r.player_count
    }))
  }

  getMatch(matchId: string): ImportedMatch | undefined {
    const summary = this.listMatches(1000).find((m) => m.matchId === matchId)
    if (!summary) return undefined
    const rows = this.db
      .prepare(`SELECT mp.*, p.avatar_url FROM match_players mp LEFT JOIN players p ON p.steam_id = mp.steam_id WHERE mp.match_id = ? ORDER BY mp.team, mp.score DESC`)
      .all(matchId) as Array<{
      steam_id: string
      name: string
      team: Team
      kills: number
      assists: number
      deaths: number
      mvps: number
      headshot_percentage: number | null
      score: number
      ping: number | null
      avatar_url: string | null
    }>
    const players: ImportedMatchPlayer[] = rows.map((r) => ({
      steamId: r.steam_id,
      name: r.name,
      avatarUrl: r.avatar_url ?? undefined,
      team: r.team,
      stats: {
        kills: r.kills,
        assists: r.assists,
        deaths: r.deaths,
        mvps: r.mvps,
        headshotPercentage: r.headshot_percentage ?? undefined,
        score: r.score,
        ping: r.ping ?? undefined
      }
    }))
    const { playerCount: _pc, ...rest } = summary
    void _pc
    return { ...rest, players }
  }

  /** Most recent imported matches (newest first) — used to back-fill live lobbies. */
  recentMatches(limit = 5): ImportedMatch[] {
    return this.listMatches(limit)
      .map((m) => this.getMatch(m.matchId))
      .filter((m): m is ImportedMatch => !!m)
  }

  // ---- maintenance -------------------------------------------------------------

  /** Deletes all history (players, snapshots, sessions, bans). Keeps the API cache. */
  clearHistory(): void {
    const run = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM match_players`).run()
      this.db.prepare(`DELETE FROM matches`).run()
      this.db.prepare(`DELETE FROM encounters`).run()
      this.db.prepare(`DELETE FROM match_sessions`).run()
      this.db.prepare(`DELETE FROM ban_events`).run()
      this.db.prepare(`DELETE FROM scout_scores`).run()
      this.db.prepare(`DELETE FROM faceit_snapshots`).run()
      this.db.prepare(`DELETE FROM steam_snapshots`).run()
      this.db.prepare(`DELETE FROM players`).run()
    })
    run()
  }

  counts(): { players: number; watched: number; sessions: number; matches: number; cache: number } {
    const one = (sql: string): number => (this.db.prepare(sql).get() as { n: number }).n
    return {
      players: one(`SELECT COUNT(*) n FROM players`),
      watched: one(`SELECT COUNT(*) n FROM players WHERE watched = 1`),
      sessions: one(`SELECT COUNT(*) n FROM match_sessions`),
      matches: one(`SELECT COUNT(*) n FROM matches`),
      cache: one(`SELECT COUNT(*) n FROM api_cache`)
    }
  }
}
