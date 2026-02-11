import { ClaimFeedback } from '../models/ClaimFeedback.js'
import { AppError } from '../middleware/errorHandler.js'

export const feedbackController = {
  create(req, res, next) {
    try {
      const { claim_id, document_id, reference_doc_id, decision, reason, confidence_score, reviewer_notes } = req.body
      if (!claim_id) throw new AppError('claim_id is required', 400)
      if (!decision) throw new AppError('decision is required', 400)

      const feedback = ClaimFeedback.create({
        claim_id, document_id, reference_doc_id,
        decision, reason, confidence_score, reviewer_notes
      })
      res.status(201).json(feedback)
    } catch (err) {
      next(err)
    }
  },

  list(req, res, next) {
    try {
      const { claim_id, document_id } = req.query
      let results
      if (claim_id) {
        results = ClaimFeedback.findByClaim(claim_id)
      } else if (document_id) {
        results = ClaimFeedback.findByDocument(document_id)
      } else {
        throw new AppError('claim_id or document_id query param required', 400)
      }
      res.json({ feedback: results })
    } catch (err) {
      next(err)
    }
  },

  update(req, res, next) {
    try {
      const existing = ClaimFeedback.findById(req.params.id)
      if (!existing) throw new AppError('Feedback not found', 404)
      const updated = ClaimFeedback.update(req.params.id, req.body)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  }
}
