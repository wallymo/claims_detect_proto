import { Router } from 'express'
import { documentLineageController } from '../controllers/documentLineageController.js'

const router = Router()

router.post('/', documentLineageController.create)
router.get('/:hash', documentLineageController.getByHash)
router.get('/:hash/parent', documentLineageController.getParent)

export default router
