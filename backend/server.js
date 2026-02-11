import 'dotenv/config'
import { initDb, closeDb } from './src/config/database.js'
import { createApp } from './src/app.js'
import { env } from './src/config/env.js'
import fs from 'fs'
import path from 'path'

// Ensure directories exist
const dirs = [
  path.resolve(env.UPLOAD_DIR, 'references'),
  path.resolve('data')
]
dirs.forEach(dir => fs.mkdirSync(dir, { recursive: true }))

// Initialize database
initDb()

// Create and start app
const app = createApp()
const server = app.listen(env.PORT, () => {
  console.log(`Backend running on http://localhost:${env.PORT}`)
  console.log(`Environment: ${env.NODE_ENV}`)
})

// Graceful shutdown
const shutdown = () => {
  console.log('\nShutting down...')
  server.close(() => {
    closeDb()
    process.exit(0)
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
