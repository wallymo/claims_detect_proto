import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
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

  sqliteVec.load(db)

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

  // 004: soft delete (deleted_at column on reference_documents)
  const migration004Path = path.resolve(__dirname, '../../migrations/004_soft_delete.sql')
  const migration004 = fs.readFileSync(migration004Path, 'utf-8')
  for (const stmt of migration004.split(';').map(s => s.trim()).filter(Boolean)) {
    try {
      db.exec(stmt)
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err
      }
    }
  }

  // 005: reference_passages for semantic search embeddings
  const migration005Path = path.resolve(__dirname, '../../migrations/005_reference_passages.sql')
  const migration005 = fs.readFileSync(migration005Path, 'utf-8')
  db.exec(migration005)

  // 006: fact embeddings (embedding + embedding_model columns on reference_facts)
  const migration006Path = path.resolve(__dirname, '../../migrations/006_fact_embeddings.sql')
  const migration006 = fs.readFileSync(migration006Path, 'utf-8')
  for (const stmt of migration006.split(';').map(s => s.trim()).filter(Boolean)) {
    try {
      db.exec(stmt)
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err
      }
    }
  }

  // 007: missing indexes on folder_id and document_id
  const migration007Path = path.resolve(__dirname, '../../migrations/007_add_missing_indexes.sql')
  const migration007 = fs.readFileSync(migration007Path, 'utf-8')
  db.exec(migration007)

  // 008: training_sessions table for feedback loop
  const migration008Path = path.resolve(__dirname, '../../migrations/008_training_sessions.sql')
  const migration008 = fs.readFileSync(migration008Path, 'utf-8')
  db.exec(migration008)

  // 009: rejection_type + corrected_reference_id on claim_feedback
  const migration009Path = path.resolve(__dirname, '../../migrations/009_rejection_types.sql')
  const migration009 = fs.readFileSync(migration009Path, 'utf-8')
  for (const stmt of migration009.split(';').map(s => s.trim()).filter(Boolean)) {
    try {
      db.exec(stmt)
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        throw err
      }
    }
  }

  // 010: fix training_sessions.brand_id FK to ON DELETE CASCADE
  const migration010Path = path.resolve(__dirname, '../../migrations/010_fix_training_sessions_cascade.sql')
  const migration010 = fs.readFileSync(migration010Path, 'utf-8')
  db.exec(migration010)

  // 011: persistent analysis cache
  const migration011Path = path.resolve(__dirname, '../../migrations/011_analysis_cache.sql')
  const migration011 = fs.readFileSync(migration011Path, 'utf-8')
  db.exec(migration011)

  // 012: analysis run history
  const migration012Path = path.resolve(__dirname, '../../migrations/012_analysis_runs.sql')
  const migration012 = fs.readFileSync(migration012Path, 'utf-8')
  db.exec(migration012)

  // 013: page_boundaries for accurate page resolution
  const migration013Path = path.resolve(__dirname, '../../migrations/013_page_boundaries.sql')
  const migration013 = fs.readFileSync(migration013Path, 'utf-8')
  for (const stmt of migration013.split(';').map(s => s.trim()).filter(Boolean)) {
    try { db.exec(stmt) } catch (err) { if (!err.message.includes('duplicate column')) throw err }
  }

  // 014: citation_metadata column on reference_documents
  const migration014Path = path.resolve(__dirname, '../../migrations/014_citation_metadata.sql')
  const migration014 = fs.readFileSync(migration014Path, 'utf-8')
  for (const stmt of migration014.split(';').map(s => s.trim()).filter(Boolean)) {
    try { db.exec(stmt) } catch (err) { if (!err.message.includes('duplicate column')) throw err }
  }

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
