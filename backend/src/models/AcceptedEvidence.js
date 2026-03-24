import { getDb } from '../config/database.js'

export const AcceptedEvidence = {
  create({ evidence_id, claim_id, reference_id, page_number, type, rects, text, origin, suggestion_id, location_annotation }) {
    const db = getDb()
    db.prepare(`
      INSERT INTO accepted_evidence
        (evidence_id, claim_id, reference_id, page_number, type, rects, text, origin, suggestion_id, location_annotation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evidence_id, claim_id, reference_id, page_number,
      type, JSON.stringify(rects), text, origin, suggestion_id || null, location_annotation || null
    )
    return db.prepare('SELECT * FROM accepted_evidence WHERE evidence_id = ?').get(evidence_id)
  },

  findByClaimAndRef(claimId, referenceId) {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM accepted_evidence
      WHERE claim_id = ? AND reference_id = ?
      ORDER BY page_number, created_at
    `).all(claimId, referenceId)
    return rows.map(r => ({ ...r, rects: JSON.parse(r.rects) }))
  },

  delete(evidenceId) {
    const db = getDb()
    db.prepare('DELETE FROM accepted_evidence WHERE evidence_id = ?').run(evidenceId)
  }
}
