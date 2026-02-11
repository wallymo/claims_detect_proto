import { Router } from 'express'
import { factController } from '../controllers/factController.js'
import { validateIdParam } from '../middleware/validate.js'

// Brand-scoped routes (mounted at /api/brands/:brandId)
export const brandFactRoutes = Router({ mergeParams: true })
brandFactRoutes.get('/references/:refId/facts', validateIdParam('refId'), factController.getFacts)
brandFactRoutes.get('/facts/summary', factController.getSummary)

// Reference-scoped routes (mounted at /api/references)
export const referenceFactRoutes = Router()
referenceFactRoutes.post('/:refId/facts/extract', validateIdParam('refId'), factController.triggerExtraction)

// Fact-scoped routes (mounted at /api/facts)
export const factRoutes = Router()
factRoutes.patch('/:factId/feedback', factController.updateFeedback)
