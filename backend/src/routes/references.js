import { Router } from 'express'
import { referenceController } from '../controllers/referenceController.js'
import { upload } from '../middleware/upload.js'
import { validateIdParam, validateReferenceUpdate } from '../middleware/validate.js'

const router = Router({ mergeParams: true })

router.post('/bulk-move', referenceController.bulkMove)
router.post('/bulk-delete', referenceController.bulkDelete)
router.post('/', upload.single('file'), referenceController.upload)
router.get('/', referenceController.list)
router.get('/:refId', validateIdParam('refId'), referenceController.get)
router.patch('/:refId', validateIdParam('refId'), validateReferenceUpdate, referenceController.update)
router.delete('/:refId', validateIdParam('refId'), referenceController.delete)

export default router
