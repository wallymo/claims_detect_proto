import { getDb } from '../config/database.js'

function hydrateRow(row) {
  if (!row) return null
  return {
    ...row,
    rects: typeof row.rects === 'string' ? JSON.parse(row.rects) : row.rects,
  }
}

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
    return hydrateRow(
      db.prepare('SELECT * FROM accepted_evidence WHERE evidence_id = ?').get(evidence_id)
    )
  },

  findByClaimAndRef(claimId, referenceId) {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM accepted_evidence
      WHERE claim_id = ? AND reference_id = ?
      ORDER BY page_number, created_at
    `).all(claimId, referenceId)
    return rows.map(hydrateRow)
  },

  findByClaimIds(claimIds) {
    if (!Array.isArray(claimIds) || claimIds.length === 0) {
      return []
    }

    const db = getDb()
    const placeholders = claimIds.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT * FROM accepted_evidence
      WHERE claim_id IN (${placeholders})
      ORDER BY claim_id, page_number, created_at
    `).all(...claimIds)
    return rows.map(hydrateRow)
  },

  updateLocationAnnotation(evidenceId, locationAnnotation) {
    const db = getDb()
    db.prepare(`
      UPDATE accepted_evidence
      SET location_annotation = ?
      WHERE evidence_id = ?
    `).run(locationAnnotation, evidenceId)

    return hydrateRow(
      db.prepare('SELECT * FROM accepted_evidence WHERE evidence_id = ?').get(evidenceId)
    )
  },

  delete(evidenceId) {
    const db = getDb()
    db.prepare('DELETE FROM accepted_evidence WHERE evidence_id = ?').run(evidenceId)
  }
}
