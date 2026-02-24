import { AnalysisRun } from '../models/AnalysisRun.js'
import { AppError } from '../middleware/errorHandler.js'

function parseNullableInt(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parseNullableFloat(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const analysisRunController = {
  create(req, res, next) {
    try {
      const {
        brand_id,
        document_name,
        model,
        training_example_count,
        ecosystem_example_count,
        claim_count,
        matched_count,
        avg_confidence
      } = req.body || {}

      if (!document_name) throw new AppError('document_name is required', 400)
      if (!model) throw new AppError('model is required', 400)
      if (claim_count === undefined || claim_count === null || claim_count === '') {
        throw new AppError('claim_count is required', 400)
      }

      const run = AnalysisRun.create({
        brand_id: parseNullableInt(brand_id),
        document_name,
        model,
        training_example_count: parseNullableInt(training_example_count) ?? 0,
        ecosystem_example_count: parseNullableInt(ecosystem_example_count) ?? 0,
        claim_count: parseNullableInt(claim_count) ?? 0,
        matched_count: parseNullableInt(matched_count) ?? 0,
        avg_confidence: parseNullableFloat(avg_confidence)
      })

      res.status(201).json(run)
    } catch (err) {
      next(err)
    }
  },

  listByDocument(req, res, next) {
    try {
      const { document_name, brand_id } = req.query
      if (!document_name) throw new AppError('document_name query param required', 400)

      const runs = AnalysisRun.findByDocument(document_name, parseNullableInt(brand_id))
      res.json({ runs })
    } catch (err) {
      next(err)
    }
  },

  listRecent(req, res, next) {
    try {
      const { limit } = req.query
      const runs = AnalysisRun.findRecent(limit)
      res.json({ runs })
    } catch (err) {
      next(err)
    }
  }
}
