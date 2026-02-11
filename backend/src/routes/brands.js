import { Router } from 'express'
import { brandController } from '../controllers/brandController.js'
import { validateBrandCreate, validateIdParam } from '../middleware/validate.js'

const router = Router()

router.post('/', validateBrandCreate, brandController.create)
router.get('/', brandController.list)
router.get('/:id', validateIdParam('id'), brandController.get)
router.delete('/:id', validateIdParam('id'), brandController.delete)

export default router
