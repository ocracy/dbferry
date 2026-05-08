import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { runMigrations } from './migrations'

let dbInstance: Database.Database | null = null

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance
  const dbPath = join(app.getPath('userData'), 'dbferry.sqlite')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  dbInstance = db
  return db
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}
