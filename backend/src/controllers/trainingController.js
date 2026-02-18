import { TrainingSession } from '../models/TrainingSession.js'
import { AppError } from '../middleware/errorHandler.js'

export const trainingController = {
  create(req, res, next) {
    try {
      const { brand_id, label, document_name, approved_claims, prompt_text } = req.body
      if (!brand_id) throw new AppError('brand_id is required', 400)
      if (!document_name) throw new AppError('document_name is required', 400)

      const session = TrainingSession.create({
        brand_id,
        label: label || document_name,
        document_name,
        approved_claims: approved_claims || [],
        prompt_text: prompt_text || null
      })
      res.status(201).json(session)
    } catch (err) {
      next(err)
    }
  },

  list(req, res, next) {
    try {
      const { brand_id } = req.query
      if (!brand_id) throw new AppError('brand_id query param required', 400)
      const sessions = TrainingSession.listActiveByBrand(parseInt(brand_id, 10))
      res.json({ sessions })
    } catch (err) {
      next(err)
    }
  },

  updateClaims(req, res, next) {
    try {
      const { id } = req.params
      const existing = TrainingSession.findById(id)
      if (!existing) throw new AppError('Training session not found', 404)

      const { approved_claims } = req.body
      if (!Array.isArray(approved_claims)) throw new AppError('approved_claims must be an array', 400)

      const updated = TrainingSession.updateClaims(id, approved_claims)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  },

  delete(req, res, next) {
    try {
      const { id } = req.params
      const existing = TrainingSession.findById(id)
      if (!existing) throw new AppError('Training session not found', 404)
      TrainingSession.delete(id)
      res.json({ deleted: true })
    } catch (err) {
      next(err)
    }
  },

  clear(req, res, next) {
    try {
      const { brand_id } = req.body
      if (!brand_id) throw new AppError('brand_id is required', 400)
      const result = TrainingSession.clearByBrand(brand_id)
      res.json({ cleared: result.changes })
    } catch (err) {
      next(err)
    }
  },

  export(req, res, next) {
    try {
      const { brand_id } = req.query
      if (!brand_id) throw new AppError('brand_id query param required', 400)

      const sessions = TrainingSession.listActiveByBrand(parseInt(brand_id, 10))

      // Build JSONL — only include sessions that have a prompt and at least one approved claim
      const lines = sessions
        .filter(s => s.prompt_text && s.approved_claims.length > 0)
        .map(s => JSON.stringify({
          text_input: s.prompt_text,
          output: JSON.stringify(s.approved_claims)
        }))

      const jsonl = lines.join('\n')

      res.setHeader('Content-Type', 'application/jsonl')
      res.setHeader('Content-Disposition', `attachment; filename="training-data-brand-${brand_id}.jsonl"`)
      res.send(jsonl)
    } catch (err) {
      next(err)
    }
  }
}
