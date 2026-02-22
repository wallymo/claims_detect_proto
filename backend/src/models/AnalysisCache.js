import { getDb } from '../config/database.js'
import { env } from '../config/env.js'

function parseRow(row) {
  if (!row) return null

  let payload = null
  try {
    payload = row.payload_json ? JSON.parse(row.payload_json) : null
  } catch {
    payload = null
  }

  return {
    id: row.id,
    cache_key: row.cache_key,
    cache_version: row.cache_version,
    brand_id: row.brand_id,
    file_sha256: row.file_sha256,
    model: row.model,
    prompt_key: row.prompt_key,
    prompt_hash: row.prompt_hash,
    doc_type: row.doc_type,
    reference_fingerprint: row.reference_fingerprint,
    payload,
    payload_size_bytes: row.payload_size_bytes,
    diagnostics_enabled: !!row.diagnostics_enabled,
    hit_count: row.hit_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_accessed_at: row.last_accessed_at,
    expires_at: row.expires_at
  }
}

function resolveMaxRows(maxRows) {
  const parsed = Number.parseInt(maxRows, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return Math.max(1, Number.parseInt(env.ANALYSIS_CACHE_MAX_ROWS, 10) || 500)
  }
  return parsed
}

function resolveTtlDays(ttlDays) {
  const parsed = Number.parseInt(ttlDays, 10)
  if (!Number.isFinite(parsed)) {
    return Number.parseInt(env.ANALYSIS_CACHE_TTL_DAYS, 10) || 30
  }
  return parsed
}

export const AnalysisCache = {
  findByKey(cacheKey, { touch = true } = {}) {
    const db = getDb()
    const row = db.prepare(`
      SELECT *
      FROM analysis_cache
      WHERE cache_key = ?
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
      LIMIT 1
    `).get(cacheKey)
    if (!row) return null

    if (touch) {
      db.prepare(`
        UPDATE analysis_cache
        SET hit_count = hit_count + 1, last_accessed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(row.id)
      row.hit_count += 1
      row.last_accessed_at = new Date().toISOString()
    }

    return parseRow(row)
  },

  upsert({
    cache_key,
    cache_version,
    brand_id = null,
    file_sha256,
    model,
    prompt_key,
    prompt_hash,
    doc_type,
    reference_fingerprint,
    payload,
    diagnostics_enabled = false,
    ttlDays
  }) {
    const db = getDb()
    const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload || {})
    const payloadSizeBytes = Buffer.byteLength(payloadJson, 'utf8')
    const effectiveTtlDays = resolveTtlDays(ttlDays)

    db.prepare(`
      INSERT INTO analysis_cache (
        cache_key,
        cache_version,
        brand_id,
        file_sha256,
        model,
        prompt_key,
        prompt_hash,
        doc_type,
        reference_fingerprint,
        payload_json,
        payload_size_bytes,
        diagnostics_enabled,
        expires_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        CASE
          WHEN ? > 0 THEN datetime('now', '+' || ? || ' days')
          ELSE NULL
        END
      )
      ON CONFLICT(cache_key) DO UPDATE SET
        cache_version = excluded.cache_version,
        brand_id = excluded.brand_id,
        file_sha256 = excluded.file_sha256,
        model = excluded.model,
        prompt_key = excluded.prompt_key,
        prompt_hash = excluded.prompt_hash,
        doc_type = excluded.doc_type,
        reference_fingerprint = excluded.reference_fingerprint,
        payload_json = excluded.payload_json,
        payload_size_bytes = excluded.payload_size_bytes,
        diagnostics_enabled = excluded.diagnostics_enabled,
        updated_at = CURRENT_TIMESTAMP,
        last_accessed_at = CURRENT_TIMESTAMP,
        expires_at = CASE
          WHEN ? > 0 THEN datetime('now', '+' || ? || ' days')
          ELSE NULL
        END
    `).run(
      cache_key,
      cache_version,
      brand_id,
      file_sha256,
      model,
      prompt_key,
      prompt_hash,
      doc_type,
      reference_fingerprint,
      payloadJson,
      payloadSizeBytes,
      diagnostics_enabled ? 1 : 0,
      effectiveTtlDays,
      effectiveTtlDays,
      effectiveTtlDays,
      effectiveTtlDays
    )

    return this.findByKey(cache_key, { touch: false })
  },

  deleteByKey(cacheKey) {
    const db = getDb()
    return db.prepare('DELETE FROM analysis_cache WHERE cache_key = ?').run(cacheKey).changes
  },

  pruneExpired() {
    const db = getDb()
    return db.prepare(`
      DELETE FROM analysis_cache
      WHERE expires_at IS NOT NULL
        AND datetime(expires_at) <= datetime('now')
    `).run().changes
  },

  pruneLRU(maxRows = env.ANALYSIS_CACHE_MAX_ROWS) {
    const db = getDb()
    const limit = resolveMaxRows(maxRows)
    const total = db.prepare('SELECT COUNT(*) as count FROM analysis_cache').get()?.count || 0
    if (total <= limit) return 0
    const overflow = total - limit

    return db.prepare(`
      DELETE FROM analysis_cache
      WHERE id IN (
        SELECT id
        FROM analysis_cache
        ORDER BY datetime(last_accessed_at) ASC, id ASC
        LIMIT ?
      )
    `).run(overflow).changes
  },

  prune({ maxRows = env.ANALYSIS_CACHE_MAX_ROWS } = {}) {
    const expired = this.pruneExpired()
    const lru = this.pruneLRU(maxRows)
    return {
      expired_deleted: expired,
      lru_deleted: lru
    }
  }
}
