import { Router } from 'express'
import { versionController } from '../controllers/versionController.js'

const router = Router()

router.post('/', versionController.create)
router.get('/brand/:brandId', versionController.listByBrand)
router.get('/:hash/latest', versionController.getLatest)
router.get('/:hash', versionController.listByHash)
router.get('/:hash/:versionNumber', versionController.getByVersion)

export default router
