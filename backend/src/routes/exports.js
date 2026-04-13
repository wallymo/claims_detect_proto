import { Router } from 'express'
import { exportController, exportUpload } from '../controllers/exportController.js'

const router = Router()

router.post('/mlr', exportUpload, exportController.exportMlrPdf)

export default router
