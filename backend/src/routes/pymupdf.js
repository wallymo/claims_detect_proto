import { Router } from 'express'
import { pymupdfController, pymupdfUpload } from '../controllers/pymupdfController.js'

const router = Router()

router.post('/', pymupdfUpload, pymupdfController.extract)

export default router
