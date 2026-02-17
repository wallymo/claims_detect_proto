import brandRoutes from './brands.js'
import referenceRoutes from './references.js'
import fileRoutes from './files.js'
import feedbackRoutes from './feedback.js'
import folderRoutes from './folders.js'
import { brandFactRoutes, referenceFactRoutes, factRoutes } from './facts.js'
import passageRoutes from './passages.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function registerRoutes(app) {
  app.use('/api/brands', brandRoutes)
  app.use('/api/brands/:brandId/references', referenceRoutes)
  app.use('/api/brands/:brandId/passages', passageRoutes)
  app.use('/api/brands/:brandId', brandFactRoutes)
  app.use('/api/references', referenceFactRoutes)
  app.use('/api/facts', factRoutes)
  app.use('/api/files', fileRoutes)
  app.use('/api/feedback', feedbackRoutes)
  app.use('/api/folders', folderRoutes)

  // Temporary: capture V2 pipeline diagnostics to disk for analysis (dev only)
  if (process.env.NODE_ENV !== 'production') {
    app.post('/api/diagnostics', (req, res) => {
      const outPath = path.resolve(__dirname, '../../../diagnostics-output.json')
      fs.writeFile(outPath, JSON.stringify(req.body, null, 2), (err) => {
        if (err) return res.status(500).json({ error: 'Failed to write diagnostics' })
        res.json({ saved: true })
      })
    })
  }
}
