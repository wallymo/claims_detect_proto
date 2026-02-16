import { Router } from 'express'
import { passageController } from '../controllers/passageController.js'

const router = Router({ mergeParams: true })

router.post('/search', passageController.search)
router.get('/status', passageController.status)

export default router
