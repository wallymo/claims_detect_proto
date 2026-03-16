import { DocumentLineage } from '../models/DocumentLineage.js'
import { AppError } from '../middleware/errorHandler.js'

export const documentLineageController = {
  create(req, res, next) {
    try {
      const { document_hash, parent_hash, brand_id, similarity_score } = req.body || {}
      if (!document_hash) throw new AppError('document_hash is required', 400)

      const lineage = DocumentLineage.create({
        document_hash,
        parent_hash: parent_hash || null,
        brand_id: brand_id ? parseInt(brand_id, 10) : null,
        similarity_score: similarity_score != null ? parseFloat(similarity_score) : null
      })

      res.status(201).json(lineage)
    } catch (err) {
      next(err)
    }
  },

  getByHash(req, res, next) {
    try {
      const { hash } = req.params
      if (!hash) throw new AppError('document hash is required', 400)

      const lineage = DocumentLineage.findByHash(hash)
      res.json({ lineage })
    } catch (err) {
      next(err)
    }
  },

  getParent(req, res, next) {
    try {
      const { hash } = req.params
      if (!hash) throw new AppError('document hash is required', 400)

      const parent = DocumentLineage.findParent(hash)
      res.json({ lineage: parent })
    } catch (err) {
      next(err)
    }
  }
}
