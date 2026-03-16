import { Router } from 'express'
import { brandPatternController } from '../controllers/brandPatternController.js'

const router = Router({ mergeParams: true })

router.post('/', brandPatternController.record)
router.get('/:brandId', brandPatternController.listByBrand)
router.delete('/:id', brandPatternController.delete)
router.delete('/brand/:brandId', brandPatternController.clearByBrand)

export default router
