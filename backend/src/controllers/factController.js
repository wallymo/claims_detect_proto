import { ReferenceFact } from '../models/ReferenceFact.js'
import { Reference } from '../models/Reference.js'
import { Brand } from '../models/Brand.js'
import { extractFacts } from '../services/factExtractor.js'
import { AppError } from '../middleware/errorHandler.js'

export const factController = {
  getFacts(req, res, next) {
    try {
      const refId = parseInt(req.params.refId, 10)
      const ref = Reference.findById(refId)
      if (!ref) throw new AppError('Reference not found', 404)

      const result = ReferenceFact.findByReferenceId(refId)
      if (!result) {
        return res.json({ reference_id: refId, facts: [], extraction_status: null })
      }
      res.json({
        reference_id: refId,
        facts: result.facts,
        extraction_status: result.extraction_status,
        model_used: result.model_used,
        confirmed_count: result.confirmed_count,
        rejected_count: result.rejected_count,
        updated_at: result.updated_at
      })
    } catch (err) {
      next(err)
    }
  },

  async triggerExtraction(req, res, next) {
    try {
      const refId = parseInt(req.params.refId, 10)
      const ref = Reference.findById(refId)
      if (!ref) throw new AppError('Reference not found', 404)
      if (!ref.content_text) throw new AppError('Reference has no extracted text', 400)

      // Mark as pending immediately
      ReferenceFact.updateStatus(refId, 'extracting')
      res.json({ message: 'Extraction started', reference_id: refId })

      // Run extraction async (non-blocking)
      extractFacts(ref.content_text)
        .then(facts => {
          ReferenceFact.createOrUpdate(refId, facts, 'indexed', 'gemini-2.5-flash')
          console.log(`Indexed ref ${refId} (${ref.display_alias}): ${facts.length} facts`)
        })
        .catch(err => {
          console.error(`Extraction failed for ref ${refId}:`, err.message)
          ReferenceFact.updateStatus(refId, 'failed', err.message)
        })
    } catch (err) {
      next(err)
    }
  },

  getSummary(req, res, next) {
    try {
      const brandId = parseInt(req.params.brandId, 10)
      const brand = Brand.findById(brandId)
      if (!brand) throw new AppError('Brand not found', 404)

      const summary = ReferenceFact.getSummaryByBrandId(brandId)
      res.json({ brand_id: brandId, references: summary })
    } catch (err) {
      next(err)
    }
  },

  updateFeedback(req, res, next) {
    try {
      const factId = req.params.factId
      const { reference_id, decision } = req.body
      if (!reference_id) throw new AppError('reference_id is required', 400)
      if (!decision || !['confirmed', 'rejected'].includes(decision)) {
        throw new AppError('decision must be "confirmed" or "rejected"', 400)
      }

      const result = ReferenceFact.updateFeedback(reference_id, factId, decision)
      if (!result) throw new AppError('Reference facts not found', 404)
      res.json({ message: 'Feedback recorded', confirmed_count: result.confirmed_count, rejected_count: result.rejected_count })
    } catch (err) {
      next(err)
    }
  }
}
