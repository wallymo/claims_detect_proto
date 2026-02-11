import { getDb } from '../config/database.js'

export const ClaimFeedback = {
  create({ claim_id, document_id, reference_doc_id, decision, reason = '', confidence_score, reviewer_notes = '' }) {
    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO claim_feedback
        (claim_id, document_id, reference_doc_id, decision, reason, confidence_score, reviewer_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      claim_id, document_id || null, reference_doc_id || null,
      decision, reason, confidence_score || null, reviewer_notes
    )
    return this.findById(result.lastInsertRowid)
  },

  findById(id) {
    const db = getDb()
    return db.prepare('SELECT * FROM claim_feedback WHERE id = ?').get(id) || null
  },

  findByClaim(claimId) {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM claim_feedback WHERE claim_id = ? ORDER BY created_at DESC'
    ).all(claimId)
  },

  findByDocument(documentId) {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM claim_feedback WHERE document_id = ? ORDER BY created_at DESC'
    ).all(documentId)
  },

  update(id, { decision, reason, reviewer_notes }) {
    const db = getDb()
    const updates = ["updated_at = datetime('now')"]
    const params = []
    if (decision !== undefined) {
      updates.push('decision = ?')
      params.push(decision)
    }
    if (reason !== undefined) {
      updates.push('reason = ?')
      params.push(reason)
    }
    if (reviewer_notes !== undefined) {
      updates.push('reviewer_notes = ?')
      params.push(reviewer_notes)
    }
    params.push(id)
    db.prepare(`UPDATE claim_feedback SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    return this.findById(id)
  }
}
