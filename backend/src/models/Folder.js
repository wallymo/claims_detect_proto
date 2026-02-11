import { getDb } from '../config/database.js'

export const Folder = {
  getAll() {
    const db = getDb()
    return db.prepare(`
      SELECT f.*, COUNT(r.id) as document_count
      FROM folders f
      LEFT JOIN reference_documents r ON r.folder_id = f.id
      GROUP BY f.id
      ORDER BY f.created_at DESC
    `).all()
  },

  getById(id) {
    const db = getDb()
    return db.prepare('SELECT * FROM folders WHERE id = ?').get(id) || null
  },

  create(name) {
    const db = getDb()
    const result = db.prepare('INSERT INTO folders (name) VALUES (?)').run(name.trim())
    return this.getById(result.lastInsertRowid)
  },

  update(id, name) {
    const db = getDb()
    db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name.trim(), id)
    return this.getById(id)
  },

  remove(id) {
    const db = getDb()
    db.prepare('DELETE FROM folders WHERE id = ?').run(id)
  }
}
