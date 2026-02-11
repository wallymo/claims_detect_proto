import { getDb } from '../config/database.js'

export const ReferenceFact = {
  findByReferenceId(referenceId) {
    const db = getDb()
    const row = db.prepare(
      'SELECT * FROM reference_facts WHERE reference_id = ?'
    ).get(referenceId)
    if (!row) return null
    return {
      ...row,
      facts: row.facts_json ? JSON.parse(row.facts_json) : []
    }
  },

  findByBrandId(brandId) {
    const db = getDb()
    const rows = db.prepare(`
      SELECT rf.*, rd.display_alias, rd.filename
      FROM reference_facts rf
      JOIN reference_documents rd ON rd.id = rf.reference_id
      WHERE rd.brand_id = ?
        AND rf.extraction_status = 'indexed'
    `).all(brandId)
    return rows.map(row => ({
      ...row,
      facts: row.facts_json ? JSON.parse(row.facts_json) : []
    }))
  },

  createOrUpdate(referenceId, factsJson, status, model) {
    const db = getDb()
    const existing = db.prepare(
      'SELECT id FROM reference_facts WHERE reference_id = ?'
    ).get(referenceId)

    if (existing) {
      db.prepare(`
        UPDATE reference_facts
        SET facts_json = ?, extraction_status = ?, model_used = ?,
            error_message = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE reference_id = ?
      `).run(
        typeof factsJson === 'string' ? factsJson : JSON.stringify(factsJson),
        status, model, referenceId
      )
    } else {
      db.prepare(`
        INSERT INTO reference_facts (reference_id, facts_json, extraction_status, model_used)
        VALUES (?, ?, ?, ?)
      `).run(
        referenceId,
        typeof factsJson === 'string' ? factsJson : JSON.stringify(factsJson),
        status, model
      )
    }
    return this.findByReferenceId(referenceId)
  },

  updateStatus(referenceId, status, errorMessage = null) {
    const db = getDb()
    const existing = db.prepare(
      'SELECT id FROM reference_facts WHERE reference_id = ?'
    ).get(referenceId)

    if (existing) {
      db.prepare(`
        UPDATE reference_facts
        SET extraction_status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE reference_id = ?
      `).run(status, errorMessage, referenceId)
    } else {
      db.prepare(`
        INSERT INTO reference_facts (reference_id, extraction_status, error_message)
        VALUES (?, ?, ?)
      `).run(referenceId, status, errorMessage)
    }
    return this.findByReferenceId(referenceId)
  },

  updateFeedback(referenceId, factId, decision) {
    const db = getDb()
    const column = decision === 'confirmed' ? 'confirmed_count' : 'rejected_count'
    db.prepare(`
      UPDATE reference_facts
      SET ${column} = ${column} + 1, updated_at = CURRENT_TIMESTAMP
      WHERE reference_id = ?
    `).run(referenceId)
    return this.findByReferenceId(referenceId)
  },

  getSummaryByBrandId(brandId) {
    const db = getDb()
    return db.prepare(`
      SELECT rd.id as reference_id, rd.display_alias, rd.filename,
             rf.extraction_status,
             CASE WHEN rf.facts_json IS NOT NULL
               THEN json_array_length(rf.facts_json)
               ELSE 0
             END as facts_count,
             rf.model_used, rf.updated_at, rf.error_message
      FROM reference_documents rd
      LEFT JOIN reference_facts rf ON rf.reference_id = rd.id
      WHERE rd.brand_id = ?
      ORDER BY rd.upload_date DESC
    `).all(brandId)
  },

  createPending(referenceId) {
    const db = getDb()
    const existing = db.prepare(
      'SELECT id FROM reference_facts WHERE reference_id = ?'
    ).get(referenceId)
    if (!existing) {
      db.prepare(
        'INSERT INTO reference_facts (reference_id, extraction_status) VALUES (?, ?)'
      ).run(referenceId, 'pending')
    }
  }
}
