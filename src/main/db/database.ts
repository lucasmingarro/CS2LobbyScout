import Database from 'better-sqlite3'
import { MIGRATIONS, SCHEMA_VERSION } from './schema'
import { logger } from '../logger'

export type Db = Database.Database

export function openDatabase(file: string): Db {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current >= SCHEMA_VERSION) return
  const run = db.transaction(() => {
    for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
      const sql = MIGRATIONS[v]
      if (!sql) throw new Error(`Missing migration for schema version ${v}`)
      db.exec(sql)
      db.pragma(`user_version = ${v}`)
      logger.info('db.migrated', { version: v })
    }
  })
  run()
}
