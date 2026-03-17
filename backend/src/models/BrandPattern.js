import { getDb } from '../config/database.js'

export class BrandPattern {
  static upsert({ brand_id, pattern_type, pattern_json, strength_delta = 1 }) {
    const db = getDb()
    const jsonStr = typeof pattern_json === 'string' ? pattern_json : JSON.stringify(pattern_json)

    // Check if a similar pattern already exists for this brand + type
    const existing = db.prepare(
      'SELECT * FROM brand_patterns WHERE brand_id = ? AND pattern_type = ? AND pattern_json = ?'
    ).get(brand_id, pattern_type, jsonStr)

    if (existing) {
      const newStrength = Math.max(0, existing.strength + strength_delta)
      db.prepare(
        "UPDATE brand_patterns SET strength = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(newStrength, existing.id)
      return this.findById(existing.id)
    }

    const stmt = db.prepare(
      'INSERT INTO brand_patterns (brand_id, pattern_type, pattern_json, strength) VALUES (?, ?, ?, ?)'
    )
    const result = stmt.run(brand_id, pattern_type, jsonStr, Math.max(0, strength_delta))
    return this.findById(result.lastInsertRowid)
  }

  static findById(id) {
    const db = getDb()
    return db.prepare('SELECT * FROM brand_patterns WHERE id = ?').get(id) || null
  }

  static findByBrand(brandId, { minStrength = 1, limit = 50 } = {}) {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM brand_patterns WHERE brand_id = ? AND strength >= ? ORDER BY strength DESC LIMIT ?'
    ).all(brandId, minStrength, limit)
  }

  static findByBrandAndType(brandId, patternType) {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM brand_patterns WHERE brand_id = ? AND pattern_type = ? AND strength > 0 ORDER BY strength DESC'
    ).all(brandId, patternType)
  }

  static delete(id) {
    const db = getDb()
    db.prepare('DELETE FROM brand_patterns WHERE id = ?').run(id)
    return { deleted: 1 }
  }

  static clearByBrand(brandId) {
    const db = getDb()
    const result = db.prepare('DELETE FROM brand_patterns WHERE brand_id = ?').run(brandId)
    return { deleted: result.changes }
  }
}
