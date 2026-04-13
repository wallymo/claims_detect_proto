import { getDb } from '../config/database.js'

function hydrateRow(row) {
  if (!row) return null
  return {
    ...row,
    rects: typeof row.rects === 'string' ? JSON.parse(row.rects) : row.rects,
  }
}

export const EvidenceSuggestion = {
  bulkCreate(suggestions, debugData = {}, origin = 'rules_plus_ai') {
    const db = getDb()
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO evidence_suggestions
        (suggestion_id, claim_id, reference_id, page_number, type, rects, text,
         score, support_strength, rationale, status, origin, raw_shortlist, raw_gemini_response, location_annotation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested', ?, ?, ?, ?)
    `)
    const insert = db.transaction((rows) => {
      for (const s of rows) {
        stmt.run(
          s.suggestion_id, s.claim_id, s.reference_id, s.page_number,
          s.type, JSON.stringify(s.rects), s.text,
          s.score, s.support_strength, s.rationale,
          s.origin || origin,
          debugData.raw_shortlist ? JSON.stringify(debugData.raw_shortlist) : null,
          debugData.raw_gemini_response ? JSON.stringify(debugData.raw_gemini_response) : null,
          s.location_annotation || null
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
    return rows.map(hydrateRow)
  },

  deleteByClaimAndRef(claimId, referenceId) {
    const db = getDb()
    db.prepare('DELETE FROM evidence_suggestions WHERE claim_id = ? AND reference_id = ?')
      .run(claimId, referenceId)
  },

  update(suggestionId, fields) {
    const db = getDb()
    const updates = []
    const values = []

    if (fields.status !== undefined) {
      updates.push('status = ?')
      values.push(fields.status)
    }

    if (fields.location_annotation !== undefined) {
      updates.push('location_annotation = ?')
      values.push(fields.location_annotation)
    }

    if (updates.length === 0) {
      return hydrateRow(
        db.prepare('SELECT * FROM evidence_suggestions WHERE suggestion_id = ?').get(suggestionId)
      )
    }

    db.prepare(`
      UPDATE evidence_suggestions
      SET ${updates.join(', ')}
      WHERE suggestion_id = ?
    `).run(...values, suggestionId)

    return hydrateRow(
      db.prepare('SELECT * FROM evidence_suggestions WHERE suggestion_id = ?').get(suggestionId)
    )
  }
}
