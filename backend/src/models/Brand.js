import { getDb } from '../config/database.js'

export const Brand = {
  create({ name, client = '' }) {
    const db = getDb()
    const stmt = db.prepare(
      'INSERT INTO brands (name, client) VALUES (?, ?)'
    )
    const result = stmt.run(name.trim(), client.trim())
    return this.findById(result.lastInsertRowid)
  },

  findAll({ client } = {}) {
    const db = getDb()
    let query = `
      SELECT b.*, COUNT(r.id) as reference_count
      FROM brands b
      LEFT JOIN reference_documents r ON r.brand_id = b.id
    `
    const params = []
    if (client) {
      query += ' WHERE b.client = ?'
      params.push(client)
    }
    query += ' GROUP BY b.id ORDER BY b.created_at DESC'
    return db.prepare(query).all(...params)
  },

  findById(id) {
    const db = getDb()
    return db.prepare('SELECT * FROM brands WHERE id = ?').get(id) || null
  },

  delete(id) {
    const db = getDb()
    const refs = db.prepare(
      'SELECT COUNT(*) as count FROM reference_documents WHERE brand_id = ?'
    ).get(id)
    db.prepare('DELETE FROM brands WHERE id = ?').run(id)
    return { deletedReferences: refs.count }
  }
}
