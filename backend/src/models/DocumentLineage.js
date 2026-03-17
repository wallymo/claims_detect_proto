import { getDb } from '../config/database.js'

export class DocumentLineage {
  static create({ document_hash, parent_hash = null, brand_id = null, similarity_score = null }) {
    const db = getDb()
    const stmt = db.prepare(
      'INSERT INTO document_lineage (document_hash, parent_hash, brand_id, similarity_score) VALUES (?, ?, ?, ?)'
    )
    const result = stmt.run(document_hash, parent_hash, brand_id, similarity_score)
    return this.findById(result.lastInsertRowid)
  }

  static findById(id) {
    const db = getDb()
    return db.prepare('SELECT * FROM document_lineage WHERE id = ?').get(id) || null
  }

  static findByHash(documentHash) {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM document_lineage WHERE document_hash = ? ORDER BY created_at DESC LIMIT 1'
    ).get(documentHash) || null
  }

  static findParent(documentHash) {
    const db = getDb()
    const lineage = db.prepare(
      'SELECT * FROM document_lineage WHERE document_hash = ? AND parent_hash IS NOT NULL ORDER BY created_at DESC LIMIT 1'
    ).get(documentHash)
    return lineage || null
  }

  static findChildren(parentHash) {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM document_lineage WHERE parent_hash = ? ORDER BY created_at DESC'
    ).all(parentHash)
  }

  static findByBrand(brandId) {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM document_lineage WHERE brand_id = ? ORDER BY created_at DESC'
    ).all(brandId)
  }
}
