import { getDb } from '../config/database.js'

export class AnnotationVersion {
  static create({ document_hash, brand_id = null, document_name, annotations_json, source = 'ai', parent_version_id = null, created_by = 'reviewer' }) {
    const db = getDb()

    // Auto-increment version_number per document
    const latest = db.prepare(
      'SELECT MAX(version_number) as max_version FROM annotation_versions WHERE document_hash = ?'
    ).get(document_hash)
    const version_number = (latest?.max_version || 0) + 1

    const stmt = db.prepare(`
      INSERT INTO annotation_versions (document_hash, brand_id, version_number, document_name, annotations_json, source, parent_version_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(document_hash, brand_id, version_number, document_name, annotations_json, source, parent_version_id, created_by)
    return this.findById(result.lastInsertRowid)
  }

  static findById(id) {
    const db = getDb()
    return db.prepare('SELECT * FROM annotation_versions WHERE id = ?').get(id) || null
  }

  static findLatestByHash(documentHash, brandId = null) {
    const db = getDb()
    if (brandId) {
      return db.prepare(
        'SELECT * FROM annotation_versions WHERE document_hash = ? AND brand_id = ? ORDER BY version_number DESC LIMIT 1'
      ).get(documentHash, brandId) || null
    }
    return db.prepare(
      'SELECT * FROM annotation_versions WHERE document_hash = ? ORDER BY version_number DESC LIMIT 1'
    ).get(documentHash) || null
  }

  static findAllByHash(documentHash, brandId = null) {
    const db = getDb()
    if (brandId) {
      return db.prepare(
        'SELECT id, document_hash, brand_id, version_number, document_name, source, parent_version_id, created_by, created_at FROM annotation_versions WHERE document_hash = ? AND brand_id = ? ORDER BY version_number DESC'
      ).all(documentHash, brandId)
    }
    return db.prepare(
      'SELECT id, document_hash, brand_id, version_number, document_name, source, parent_version_id, created_by, created_at FROM annotation_versions WHERE document_hash = ? ORDER BY version_number DESC'
    ).all(documentHash)
  }

  static findByHashAndVersion(documentHash, versionNumber, brandId = null) {
    const db = getDb()
    if (brandId) {
      return db.prepare(
        'SELECT * FROM annotation_versions WHERE document_hash = ? AND version_number = ? AND brand_id = ?'
      ).get(documentHash, versionNumber, brandId) || null
    }
    return db.prepare(
      'SELECT * FROM annotation_versions WHERE document_hash = ? AND version_number = ?'
    ).get(documentHash, versionNumber) || null
  }

  static deleteByHash(documentHash) {
    const db = getDb()
    return db.prepare('DELETE FROM annotation_versions WHERE document_hash = ?').run(documentHash)
  }

  static findLatestPerDocumentByBrand(brandId) {
    const db = getDb()
    return db.prepare(`
      SELECT av.* FROM annotation_versions av
      INNER JOIN (
        SELECT document_hash, MAX(version_number) as max_version
        FROM annotation_versions
        WHERE brand_id = ?
        GROUP BY document_hash
      ) latest ON av.document_hash = latest.document_hash AND av.version_number = latest.max_version
      WHERE av.brand_id = ?
      ORDER BY av.created_at DESC
    `).all(brandId, brandId)
  }
}
