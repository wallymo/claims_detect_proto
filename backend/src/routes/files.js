import { Router } from 'express'
import { fileController } from '../controllers/fileController.js'
import { validateIdParam } from '../middleware/validate.js'

const router = Router()

router.get('/references/:refId', validateIdParam('refId'), fileController.serve)
router.get('/references/:refId/text', validateIdParam('refId'), fileController.getText)

export default router
