import express from 'express'
import cors from 'cors'
import { env } from './config/env.js'
import { registerRoutes } from './routes/index.js'
import { errorHandler } from './middleware/errorHandler.js'

export function createApp() {
  const app = express()

  // Body parsing
  app.use(express.json({ limit: '10mb' }))

  // CORS
  app.use(cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type']
  }))

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now()
    res.on('finish', () => {
      const ms = Date.now() - start
      console.log(`${req.method} ${req.url} ${res.statusCode} ${ms}ms`)
    })
    next()
  })

  // Routes
  registerRoutes(app)

  // 404
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  // Error handler
  app.use(errorHandler)

  return app
}
