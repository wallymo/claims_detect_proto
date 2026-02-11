import { Router } from 'express'
import { feedbackController } from '../controllers/feedbackController.js'
import { validateIdParam } from '../middleware/validate.js'

const router = Router()

router.post('/', feedbackController.create)
router.get('/', feedbackController.list)
router.patch('/:id', validateIdParam('id'), feedbackController.update)

export default router
