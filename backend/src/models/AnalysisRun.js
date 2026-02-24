import { getDb } from '../config/database.js'

export class AnalysisRun {
  static create({
    brand_id = null,
    document_name,
    model,
    training_example_count = 0,
    ecosystem_example_count = 0,
    claim_count,
    matched_count = 0,
    avg_confidence = null
  }) {
    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO analysis_runs (
        brand_id,
        document_name,
        model,
        training_example_count,
        ecosystem_example_count,
        claim_count,
        matched_count,
        avg_confidence
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      brand_id,
      document_name,
      model,
      training_example_count,
      ecosystem_example_count,
      claim_count,
      matched_count,
      avg_confidence
    )
    return this.findById(result.lastInsertRowid)
  }

  static findById(id) {
    const db = getDb()
    return db.prepare('SELECT * FROM analysis_runs WHERE id = ?').get(id) || null
  }

  static findByDocument(documentName, brandId = null) {
    const db = getDb()
    let query = 'SELECT * FROM analysis_runs WHERE document_name = ?'
    const params = [documentName]

    if (brandId !== null && brandId !== undefined) {
      query += ' AND brand_id = ?'
      params.push(brandId)
    }

    query += ' ORDER BY created_at DESC'
    return db.prepare(query).all(...params)
  }

  static findRecent(limit = 20) {
    const db = getDb()
    const parsedLimit = Number.parseInt(limit, 10)
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20
    return db.prepare('SELECT * FROM analysis_runs ORDER BY created_at DESC LIMIT ?').all(safeLimit)
  }
}
