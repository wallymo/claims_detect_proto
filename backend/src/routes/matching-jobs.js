import { Router } from 'express'
import { matchingJobController } from '../controllers/matchingJobController.js'

export const brandMatchingJobRoutes = Router({ mergeParams: true })
brandMatchingJobRoutes.post('/matching-jobs', matchingJobController.create)

export const matchingJobRoutes = Router()
matchingJobRoutes.get('/:jobId/events', matchingJobController.events)
matchingJobRoutes.get('/:jobId', matchingJobController.get)
matchingJobRoutes.delete('/:jobId', matchingJobController.cancel)
