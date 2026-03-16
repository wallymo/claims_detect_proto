import { AnnotationVersion } from '../models/AnnotationVersion.js'
import { AppError } from '../middleware/errorHandler.js'

export const versionController = {
  create(req, res, next) {
    try {
      const { document_hash, brand_id, document_name, annotations_json, source, parent_version_id } = req.body || {}
      if (!document_hash) throw new AppError('document_hash is required', 400)
      if (!document_name) throw new AppError('document_name is required', 400)
      if (!annotations_json) throw new AppError('annotations_json is required', 400)

      const version = AnnotationVersion.create({
        document_hash,
        brand_id: brand_id ? parseInt(brand_id, 10) : null,
        document_name,
        annotations_json: typeof annotations_json === 'string' ? annotations_json : JSON.stringify(annotations_json),
        source: source || 'ai',
        parent_version_id: parent_version_id ? parseInt(parent_version_id, 10) : null
      })

      res.status(201).json(version)
    } catch (err) {
      next(err)
    }
  },

  getLatest(req, res, next) {
    try {
      const { hash } = req.params
      if (!hash) throw new AppError('document hash is required', 400)

      const version = AnnotationVersion.findLatestByHash(hash)
      res.json({ version })
    } catch (err) {
      next(err)
    }
  },

  listByHash(req, res, next) {
    try {
      const { hash } = req.params
      if (!hash) throw new AppError('document hash is required', 400)

      const versions = AnnotationVersion.findAllByHash(hash)
      res.json({ versions })
    } catch (err) {
      next(err)
    }
  },

  listByBrand(req, res, next) {
    try {
      const { brandId } = req.params
      if (!brandId) throw new AppError('brandId is required', 400)

      const versions = AnnotationVersion.findLatestPerDocumentByBrand(parseInt(brandId, 10))
      res.json({ versions })
    } catch (err) {
      next(err)
    }
  },

  getByVersion(req, res, next) {
    try {
      const { hash, versionNumber } = req.params
      if (!hash) throw new AppError('document hash is required', 400)

      const version = AnnotationVersion.findByHashAndVersion(hash, parseInt(versionNumber, 10))
      if (!version) throw new AppError('Version not found', 404)
      res.json({ version })
    } catch (err) {
      next(err)
    }
  }
}
