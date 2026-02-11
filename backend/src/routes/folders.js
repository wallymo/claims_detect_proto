import { Router } from 'express'
import { folderController } from '../controllers/folderController.js'
import { validateIdParam } from '../middleware/validate.js'

const router = Router()

router.get('/', folderController.list)
router.post('/', folderController.create)
router.patch('/:id', validateIdParam('id'), folderController.update)
router.delete('/:id', validateIdParam('id'), folderController.remove)

export default router
