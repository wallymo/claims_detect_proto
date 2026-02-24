import { Router } from 'express'
import { analysisRunController } from '../controllers/analysisRunController.js'

const router = Router()

router.post('/', analysisRunController.create)
router.get('/', analysisRunController.listRecent)
router.get('/by-document', analysisRunController.listByDocument)

export default router
