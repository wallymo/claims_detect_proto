import { getDb } from '../config/database.js'

export const ReferencePassage = {
  findByReferenceId(referenceId) {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM reference_passages WHERE reference_id = ? ORDER BY passage_index'
    ).all(referenceId)
  },

  createPassages(referenceId, passages) {
    const db = getDb()

    // Delete existing passages for this reference first
    db.prepare('DELETE FROM reference_passages WHERE reference_id = ?').run(referenceId)

    const insert = db.prepare(`
      INSERT INTO reference_passages
        (reference_id, passage_index, passage_text, start_char, end_char, page_estimate, embedding, embedding_model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertMany = db.transaction((items) => {
      for (const p of items) {
        insert.run(
          referenceId,
          p.passage_index,
          p.passage_text,
          p.start_char,
          p.end_char,
          p.page_estimate,
          p.embedding,       // Buffer (Float32Array.buffer)
          p.embedding_model || 'gemini-embedding-001'
        )
      }
    })

    insertMany(passages)
    return this.findByReferenceId(referenceId)
  },

  getEmbeddingStatus(brandId) {
    const db = getDb()
    return db.prepare(`
      SELECT
        rd.id as reference_id,
        rd.display_alias,
        COUNT(rp.id) as passage_count,
        SUM(CASE WHEN rp.embedding IS NOT NULL THEN 1 ELSE 0 END) as embedded_count
      FROM reference_documents rd
      LEFT JOIN reference_passages rp ON rp.reference_id = rd.id
      WHERE rd.brand_id = ?
        AND rd.deleted_at IS NULL
      GROUP BY rd.id
      ORDER BY rd.upload_date DESC
    `).all(brandId)
  },

  /**
   * KNN search using cosine similarity.
   * Finds the top-K most similar passages to the query embedding within a brand.
   *
   * @param {number} brandId - Brand to search within
   * @param {Buffer} queryEmbedding - Float32 buffer of the query vector (768 dims)
   * @param {number} topK - Number of results to return
   * @param {number} candidatePool - Internal ranking depth before response cut
   * @returns {Array} - Passages sorted by similarity (closest first)
   */
  searchByEmbedding(brandId, queryEmbedding, topK = 5, candidatePool = 20, referenceIds = null) {
    const db = getDb()

    // Rank on minimal payload first to reduce memory and serialization overhead.
    const brandPassages = db.prepare(`
      SELECT rp.id, rp.page_estimate, rp.reference_id,
             rp.embedding, rd.display_alias
      FROM reference_passages rp
      JOIN reference_documents rd ON rd.id = rp.reference_id
      WHERE rd.brand_id = ?
        AND rd.deleted_at IS NULL
        AND rp.embedding IS NOT NULL
    `).all(brandId)

    if (brandPassages.length === 0) return []

    // Optionally filter to specific reference IDs (citation-scoped narrowing)
    let passages = brandPassages
    if (Array.isArray(referenceIds) && referenceIds.length > 0) {
      const refIdSet = new Set(referenceIds)
      passages = brandPassages.filter(row => refIdSet.has(row.reference_id))
    }

    if (passages.length === 0) return []

    // Compute cosine similarity in JS (sqlite-vec KNN works on virtual tables;
    // for our non-virtual table approach, we use JS cosine similarity on each row)
    const ranked = passages.map(row => {
      const similarity = cosineSimilarity(queryEmbedding, row.embedding)
      return {
        passage_id: row.id,
        reference_id: row.reference_id,
        display_alias: row.display_alias,
        page_estimate: row.page_estimate,
        similarity
      }
    })

    ranked.sort((a, b) => b.similarity - a.similarity)

    const poolSize = Math.max(topK, Math.min(candidatePool, ranked.length))
    const topCandidates = ranked.slice(0, poolSize)
    if (topCandidates.length === 0) return []

    const candidateIds = topCandidates.map(candidate => candidate.passage_id)
    const placeholders = candidateIds.map(() => '?').join(', ')
    const candidateTexts = db.prepare(`
      SELECT id, passage_text
      FROM reference_passages
      WHERE id IN (${placeholders})
    `).all(...candidateIds)

    const textByPassageId = new Map(candidateTexts.map(row => [row.id, row.passage_text]))

    return topCandidates
      .map((candidate, index) => ({
        ...candidate,
        rank: index + 1,
        is_top_k: index < topK,
        passage_text: textByPassageId.get(candidate.passage_id) || ''
      }))
  }
}

/**
 * Compute cosine similarity between two Float32 embedding buffers.
 */
function cosineSimilarity(bufA, bufB) {
  const a = new Float32Array(bufA.buffer, bufA.byteOffset, bufA.byteLength / 4)
  const b = new Float32Array(bufB.buffer, bufB.byteOffset, bufB.byteLength / 4)

  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}
