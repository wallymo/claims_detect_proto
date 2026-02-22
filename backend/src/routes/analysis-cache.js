import { Router } from 'express'
import { analysisCacheController } from '../controllers/analysisCacheController.js'

const router = Router()

router.get('/', analysisCacheController.get)
router.post('/', analysisCacheController.upsert)
router.delete('/', analysisCacheController.delete)
router.post('/prune', analysisCacheController.prune)

export default router
