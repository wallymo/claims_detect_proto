import brandRoutes from './brands.js'
import referenceRoutes from './references.js'
import fileRoutes from './files.js'
import feedbackRoutes from './feedback.js'
import folderRoutes from './folders.js'
import { brandFactRoutes, referenceFactRoutes, factRoutes } from './facts.js'

export function registerRoutes(app) {
  app.use('/api/brands', brandRoutes)
  app.use('/api/brands/:brandId/references', referenceRoutes)
  app.use('/api/brands/:brandId', brandFactRoutes)
  app.use('/api/references', referenceFactRoutes)
  app.use('/api/facts', factRoutes)
  app.use('/api/files', fileRoutes)
  app.use('/api/feedback', feedbackRoutes)
  app.use('/api/folders', folderRoutes)
}
