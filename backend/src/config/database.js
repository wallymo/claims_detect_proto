import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { env } from './env.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let db = null

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.')
  return db
}

export function initDb() {
  const dbDir = path.dirname(path.resolve(env.DB_PATH))
  fs.mkdirSync(dbDir, { recursive: true })

  db = new Database(path.resolve(env.DB_PATH))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Run migrations
  const migrationPath = path.resolve(__dirname, '../../migrations/001_initial_schema.sql')
  const migration = fs.readFileSync(migrationPath, 'utf-8')
  db.exec(migration)

  const migration002Path = path.resolve(__dirname, '../../migrations/002_add_folders.sql')
  const migration002 = fs.readFileSync(migration002Path, 'utf-8')
  // Split migration file on semicolons and run each statement individually
  // (ALTER TABLE will error if column already exists, so we handle gracefully)
  for (const stmt of migration002.split(';').map(s => s.trim()).filter(Boolean)) {
    try {
      db.exec(stmt)
    } catch (err) {
      // Ignore "duplicate column" errors from re-running ALTER TABLE
      if (!err.message.includes('duplicate column')) {
        throw err
      }
    }
  }

  // 003: reference_facts table
  const migration003Path = path.resolve(__dirname, '../../migrations/003_reference_facts.sql')
  const migration003 = fs.readFileSync(migration003Path, 'utf-8')
  db.exec(migration003)

  console.log('Database initialized:', env.DB_PATH)
  return db
}

export function closeDb() {
  if (db) {
    db.close()
    db = null
    console.log('Database connection closed')
  }
}

export function resetDb() {
  if (db) {
    db.exec('DROP TABLE IF EXISTS claim_feedback')
    db.exec('DROP TABLE IF EXISTS reference_documents')
    db.exec('DROP TABLE IF EXISTS brands')
    initDb()
    console.log('Database reset complete')
  }
}
