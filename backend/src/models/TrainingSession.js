import { getDb } from '../config/database.js'

export const TrainingSession = {
  create({ brand_id, label = '', document_name, approved_claims = [], prompt_text = null }) {
    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO training_sessions
        (brand_id, label, document_name, approved_claims, prompt_text)
      VALUES (?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      brand_id,
      label,
      document_name,
      JSON.stringify(approved_claims),
      prompt_text || null
    )
    return this.findById(result.lastInsertRowid)
  },

  findById(id) {
    const db = getDb()
    const row = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(id) || null
    return row ? this._parse(row) : null
  },

  listActiveByBrand(brandId) {
    const db = getDb()
    const rows = db.prepare(
      'SELECT * FROM training_sessions WHERE brand_id = ? AND cleared_at IS NULL ORDER BY created_at DESC'
    ).all(brandId)
    return rows.map(r => this._parse(r))
  },

  updateClaims(id, approvedClaims) {
    const db = getDb()
    db.prepare('UPDATE training_sessions SET approved_claims = ? WHERE id = ?')
      .run(JSON.stringify(approvedClaims), id)
    return this.findById(id)
  },

  delete(id) {
    const db = getDb()
    return db.prepare('DELETE FROM training_sessions WHERE id = ?').run(id)
  },

  clearByBrand(brandId) {
    const db = getDb()
    return db.prepare(
      "UPDATE training_sessions SET cleared_at = datetime('now') WHERE brand_id = ? AND cleared_at IS NULL"
    ).run(brandId)
  },

  _parse(row) {
    return {
      ...row,
      approved_claims: JSON.parse(row.approved_claims || '[]')
    }
  }
}
