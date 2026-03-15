import { Router } from 'express'
import { documentAiController, memoryUpload } from '../controllers/documentAiController.js'

const router = Router()

router.post('/extract', memoryUpload, documentAiController.extract)

export default router
