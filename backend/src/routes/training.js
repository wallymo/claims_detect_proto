import { Router } from 'express'
import { trainingController } from '../controllers/trainingController.js'
import { validateIdParam } from '../middleware/validate.js'

const router = Router()

router.post('/', trainingController.create)
router.get('/', trainingController.list)
router.patch('/:id/claims', validateIdParam('id'), trainingController.updateClaims)
router.delete('/:id', validateIdParam('id'), trainingController.delete)
router.post('/clear', trainingController.clear)
router.get('/export', trainingController.export)

export default router
