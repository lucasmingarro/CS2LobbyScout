/** SQLite schema. Bump SCHEMA_VERSION and add a migration step when changing tables. */
export const SCHEMA_VERSION = 2

export const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE IF NOT EXISTS players (
      steam_id      TEXT PRIMARY KEY,
      current_name  TEXT NOT NULL,
      avatar_url    TEXT,
      first_seen    TEXT NOT NULL,
      last_seen     TEXT NOT NULL,
      times_seen    INTEGER NOT NULL DEFAULT 0,
      watched       INTEGER NOT NULL DEFAULT 0,
      watched_at    TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS steam_snapshots (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      steam_id            TEXT NOT NULL REFERENCES players(steam_id) ON DELETE CASCADE,
      profile_visibility  TEXT,
      account_created_at  TEXT,
      cs2_hours           REAL,
      vac_bans            INTEGER NOT NULL DEFAULT 0,
      game_bans           INTEGER NOT NULL DEFAULT 0,
      days_since_last_ban INTEGER,
      captured_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_steam_snapshots_player ON steam_snapshots(steam_id, captured_at DESC);

    CREATE TABLE IF NOT EXISTS faceit_snapshots (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      steam_id            TEXT NOT NULL REFERENCES players(steam_id) ON DELETE CASCADE,
      faceit_id           TEXT,
      nickname            TEXT,
      level               INTEGER,
      elo                 INTEGER,
      matches             INTEGER,
      kd                  REAL,
      adr                 REAL,
      headshot_percentage REAL,
      win_rate            REAL,
      captured_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_faceit_snapshots_player ON faceit_snapshots(steam_id, captured_at DESC);

    CREATE TABLE IF NOT EXISTS scout_scores (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      steam_id               TEXT NOT NULL REFERENCES players(steam_id) ON DELETE CASCADE,
      engine_version         INTEGER NOT NULL,
      score                  INTEGER NOT NULL,
      kd_score               INTEGER NOT NULL,
      adr_score              INTEGER NOT NULL,
      hs_score               INTEGER NOT NULL,
      account_age_score      INTEGER NOT NULL,
      match_count_score      INTEGER NOT NULL,
      win_rate_score         INTEGER NOT NULL,
      performance_jump_score INTEGER NOT NULL,
      signals_json           TEXT NOT NULL,
      captured_at            TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scout_scores_player ON scout_scores(steam_id, captured_at DESC);

    CREATE TABLE IF NOT EXISTS match_sessions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at      TEXT NOT NULL,
      source          TEXT NOT NULL,
      raw_status_hash TEXT NOT NULL,
      raw_status      TEXT
    );

    CREATE TABLE IF NOT EXISTS encounters (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      match_session_id INTEGER NOT NULL REFERENCES match_sessions(id) ON DELETE CASCADE,
      steam_id         TEXT NOT NULL REFERENCES players(steam_id) ON DELETE CASCADE,
      team             TEXT NOT NULL DEFAULT 'unknown',
      encountered_at   TEXT NOT NULL,
      UNIQUE(match_session_id, steam_id)
    );
    CREATE INDEX IF NOT EXISTS idx_encounters_player ON encounters(steam_id, encountered_at DESC);

    CREATE TABLE IF NOT EXISTS api_cache (
      cache_key   TEXT PRIMARY KEY,
      payload     TEXT NOT NULL,
      fetched_at  TEXT NOT NULL,
      expires_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache(expires_at);

    CREATE TABLE IF NOT EXISTS ban_events (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      steam_id           TEXT NOT NULL REFERENCES players(steam_id) ON DELETE CASCADE,
      previous_vac_bans  INTEGER NOT NULL,
      previous_game_bans INTEGER NOT NULL,
      vac_bans           INTEGER NOT NULL,
      game_bans          INTEGER NOT NULL,
      score_when_seen    INTEGER,
      detected_at        TEXT NOT NULL,
      acknowledged       INTEGER NOT NULL DEFAULT 0
    );
  `
,
  2: `
    CREATE TABLE IF NOT EXISTS matches (
      match_id         TEXT PRIMARY KEY,
      mode             TEXT NOT NULL,
      map              TEXT,
      played_at        TEXT NOT NULL,
      duration_seconds INTEGER,
      wait_seconds     INTEGER,
      my_score         INTEGER,
      their_score      INTEGER,
      result           TEXT,
      imported_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_matches_played ON matches(played_at DESC);

    CREATE TABLE IF NOT EXISTS match_players (
      match_id            TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
      steam_id            TEXT NOT NULL,
      name                TEXT NOT NULL,
      team                TEXT NOT NULL,
      kills               INTEGER NOT NULL DEFAULT 0,
      assists             INTEGER NOT NULL DEFAULT 0,
      deaths              INTEGER NOT NULL DEFAULT 0,
      mvps                INTEGER NOT NULL DEFAULT 0,
      headshot_percentage REAL,
      score               INTEGER NOT NULL DEFAULT 0,
      ping                INTEGER,
      PRIMARY KEY (match_id, steam_id)
    );
    CREATE INDEX IF NOT EXISTS idx_match_players_steam ON match_players(steam_id);
  `
}
