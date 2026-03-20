import { Router } from 'express'
import { evidenceController } from '../controllers/evidenceController.js'

const router = Router()

router.post('/suggestions', evidenceController.generateSuggestions)
router.delete('/suggestions', evidenceController.clearSuggestions)
router.get('/accepted', evidenceController.getAccepted)
router.patch('/suggestions/:suggestionId', evidenceController.updateSuggestionStatus)
router.post('/manual', evidenceController.createManualEvidence)
router.delete('/accepted/:evidenceId', evidenceController.deleteAcceptedEvidence)

export default router
