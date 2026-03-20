import { getDb } from '../config/database.js'

export const EvidenceSuggestion = {
  bulkCreate(suggestions, debugData = {}) {
    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO evidence_suggestions
        (suggestion_id, claim_id, reference_id, page_number, type, rects, text,
         score, support_strength, rationale, status, origin, raw_shortlist, raw_gemini_response)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested', 'rules_plus_ai', ?, ?)
    `)
    const insert = db.transaction((rows) => {
      for (const s of rows) {
        stmt.run(
          s.suggestion_id, s.claim_id, s.reference_id, s.page_number,
          s.type, JSON.stringify(s.rects), s.text,
          s.score, s.support_strength, s.rationale,
          debugData.raw_shortlist ? JSON.stringify(debugData.raw_shortlist) : null,
          debugData.raw_gemini_response ? JSON.stringify(debugData.raw_gemini_response) : null
        )
      }
    })
    insert(suggestions)
    return suggestions
  },

  findByClaimAndRef(claimId, referenceId) {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM evidence_suggestions
      WHERE claim_id = ? AND reference_id = ?
      ORDER BY score DESC
    `).all(claimId, referenceId)
    return rows.map(r => ({ ...r, rects: JSON.parse(r.rects) }))
  },

  deleteByClaimAndRef(claimId, referenceId) {
    const db = getDb()
    db.prepare('DELETE FROM evidence_suggestions WHERE claim_id = ? AND reference_id = ?')
      .run(claimId, referenceId)
  },

  updateStatus(suggestionId, status) {
    const db = getDb()
    db.prepare(`
      UPDATE evidence_suggestions SET status = ? WHERE suggestion_id = ?
    `).run(status, suggestionId)
    return db.prepare('SELECT * FROM evidence_suggestions WHERE suggestion_id = ?').get(suggestionId)
  }
}
