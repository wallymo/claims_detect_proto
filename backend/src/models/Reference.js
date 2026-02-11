import { getDb } from '../config/database.js'

export const Reference = {
  create({ brand_id, filename, display_alias, file_path, doc_type, content_text, notes = '', page_count, file_size_bytes }) {
    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO reference_documents
        (brand_id, filename, display_alias, file_path, doc_type, content_text, notes, page_count, file_size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      brand_id, filename, display_alias, file_path, doc_type,
      content_text, notes, page_count, file_size_bytes
    )
    return this.findById(result.lastInsertRowid)
  },

  findByBrand(brandId, folderId) {
    const db = getDb()
    let query = `
      SELECT rd.id, rd.brand_id, rd.folder_id, rd.filename, rd.display_alias, rd.doc_type,
             rd.page_count, rd.file_size_bytes, rd.upload_date, rd.notes,
             (rd.content_text IS NOT NULL) as has_content,
             rf.extraction_status,
             CASE WHEN rf.facts_json IS NOT NULL
               THEN json_array_length(rf.facts_json)
               ELSE 0
             END as facts_count
      FROM reference_documents rd
      LEFT JOIN reference_facts rf ON rf.reference_id = rd.id
      WHERE rd.brand_id = ?
    `
    const params = [brandId]
    if (folderId !== undefined && folderId !== null) {
      query += ' AND rd.folder_id = ?'
      params.push(folderId)
    }
    query += ' ORDER BY rd.upload_date DESC'
    return db.prepare(query).all(...params)
  },

  findAll() {
    const db = getDb()
    return db.prepare(`
      SELECT id, brand_id, filename, display_alias, doc_type, page_count, file_size_bytes,
             upload_date, notes, (content_text IS NOT NULL) as has_content
      FROM reference_documents
      ORDER BY upload_date DESC
    `).all()
  },

  findById(id) {
    const db = getDb()
    const row = db.prepare(`
      SELECT id, brand_id, display_alias, doc_type, content_text, notes,
             page_count, file_size_bytes, upload_date
      FROM reference_documents WHERE id = ?
    `).get(id)
    return row || null
  },

  _findByIdFull(id) {
    const db = getDb()
    return db.prepare('SELECT * FROM reference_documents WHERE id = ?').get(id) || null
  },

  update(id, { display_alias, notes }) {
    const db = getDb()
    const updates = []
    const params = []
    if (display_alias !== undefined) {
      updates.push('display_alias = ?')
      params.push(display_alias.trim())
    }
    if (notes !== undefined) {
      updates.push('notes = ?')
      params.push(notes)
    }
    if (updates.length === 0) return this.findById(id)
    params.push(id)
    db.prepare(`UPDATE reference_documents SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    return this.findById(id)
  },

  delete(id) {
    const db = getDb()
    const ref = db.prepare('SELECT file_path FROM reference_documents WHERE id = ?').get(id)
    db.prepare('DELETE FROM reference_documents WHERE id = ?').run(id)
    return { filePath: ref?.file_path || null }
  },

  bulkMove(ids, folderId) {
    const db = getDb()
    const placeholders = ids.map(() => '?').join(', ')
    db.prepare(
      `UPDATE reference_documents SET folder_id = ? WHERE id IN (${placeholders})`
    ).run(folderId, ...ids)
    return { updated: ids.length }
  },

  bulkDelete(ids) {
    const db = getDb()
    const placeholders = ids.map(() => '?').join(', ')
    const refs = db.prepare(
      `SELECT file_path FROM reference_documents WHERE id IN (${placeholders})`
    ).all(...ids)
    db.prepare(
      `DELETE FROM reference_documents WHERE id IN (${placeholders})`
    ).run(...ids)
    return { deleted: ids.length, filePaths: refs.map(r => r.file_path).filter(Boolean) }
  }
}
