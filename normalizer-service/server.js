import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'path'
import fs from 'fs/promises'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { validateFile, getPDFPageCount, validatePageCount } from './lib/validator.js'
import { convertToPDF, cleanupFiles } from './lib/converter.js'
import { proxyGemini, proxyOpenAI, proxyAnthropic } from './lib/ai-proxy.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3001

// Create temp directory for uploads
const TEMP_DIR = path.join(__dirname, 'temp')
await fs.mkdir(TEMP_DIR, { recursive: true })

// Configure multer for file uploads
const upload = multer({
  dest: TEMP_DIR,
  limits: {
    fileSize: 100 * 1024 * 1024  // 100MB
  }
})

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-Correlation-ID']
}))
app.use(express.json({ limit: '100mb' }))

// Correlation ID middleware
app.use((req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || `srv-${Date.now()}-${Math.random().toString(36).substring(7)}`
  req.correlationId = correlationId
  res.setHeader('X-Correlation-ID', correlationId)
  next()
})

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'document-normalizer',
    version: '1.0.0',
    endpoints: ['/normalize', '/api/analyze/gemini', '/api/analyze/openai', '/api/analyze/anthropic']
  })
})

// ============================================
// AI Proxy Endpoints (API keys server-side only)
// ============================================

/**
 * POST /api/analyze/gemini
 * Proxy requests to Google Gemini API
 */
app.post('/api/analyze/gemini', async (req, res) => {
  const startTime = Date.now()
  console.log(`[${req.correlationId}] Gemini analysis request`)

  try {
    const result = await proxyGemini(req.body)

    if (result.success) {
      console.log(`[${req.correlationId}] Gemini analysis complete in ${Date.now() - startTime}ms`)
    } else {
      console.error(`[${req.correlationId}] Gemini analysis failed:`, result.error)
    }

    res.json(result)
  } catch (error) {
    console.error(`[${req.correlationId}] Gemini proxy error:`, error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * POST /api/analyze/openai
 * Proxy requests to OpenAI API
 */
app.post('/api/analyze/openai', async (req, res) => {
  const startTime = Date.now()
  console.log(`[${req.correlationId}] OpenAI analysis request`)

  try {
    const result = await proxyOpenAI(req.body)

    if (result.success) {
      console.log(`[${req.correlationId}] OpenAI analysis complete in ${Date.now() - startTime}ms`)
    } else {
      console.error(`[${req.correlationId}] OpenAI analysis failed:`, result.error)
    }

    res.json(result)
  } catch (error) {
    console.error(`[${req.correlationId}] OpenAI proxy error:`, error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * POST /api/analyze/anthropic
 * Proxy requests to Anthropic API
 */
app.post('/api/analyze/anthropic', async (req, res) => {
  const startTime = Date.now()
  console.log(`[${req.correlationId}] Anthropic analysis request`)

  try {
    const result = await proxyAnthropic(req.body)

    if (result.success) {
      console.log(`[${req.correlationId}] Anthropic analysis complete in ${Date.now() - startTime}ms`)
    } else {
      console.error(`[${req.correlationId}] Anthropic analysis failed:`, result.error)
    }

    res.json(result)
  } catch (error) {
    console.error(`[${req.correlationId}] Anthropic proxy error:`, error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// ============================================
// Document Normalization Endpoint
// ============================================

// POST /normalize endpoint
// Only handles DOCX/PPTX → PDF conversion (PDFs bypass this endpoint entirely)
app.post('/normalize', upload.single('file'), async (req, res) => {
  const startTime = Date.now()
  const filesToCleanup = []

  try {
    const uploadedFile = req.file

    if (!uploadedFile) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      })
    }

    filesToCleanup.push(uploadedFile.path)

    // Step 1: Validate file (only DOCX/PPTX accepted)
    const validation = await validateFile(uploadedFile)
    if (!validation.valid) {
      await cleanupFiles(filesToCleanup)
      return res.status(400).json({
        success: false,
        error: validation.error
      })
    }

    const fileType = validation.fileType

    // Step 2: Convert DOCX/PPTX to PDF using LibreOffice
    const pdfPath = await convertToPDF(uploadedFile.path, fileType)
    filesToCleanup.push(pdfPath)

    // Step 3: Validate converted PDF page count
    const pageCount = await getPDFPageCount(pdfPath)
    const pageValidation = validatePageCount(pageCount)

    if (!pageValidation.valid) {
      await cleanupFiles(filesToCleanup)
      return res.status(400).json({
        success: false,
        error: pageValidation.error
      })
    }

    // Step 4: Read PDF as base64
    const pdfData = await fs.readFile(pdfPath)
    const canonicalPDF = `data:application/pdf;base64,${pdfData.toString('base64')}`

    // Step 5: Build response (simplified - no page_images, client handles that)
    const document = {
      document_id: crypto.randomUUID(),
      original_filename: uploadedFile.originalname,
      original_type: fileType,
      canonical_pdf: canonicalPDF,
      page_count: pageCount,
      conversion_time_ms: Date.now() - startTime
    }

    // Step 6: Cleanup temp files
    await cleanupFiles(filesToCleanup)

    // Step 7: Return normalized document
    res.json({
      success: true,
      document
    })

    console.log(`[${req.correlationId}] Converted ${fileType} → PDF (${pageCount} pages) in ${document.conversion_time_ms}ms`)

  } catch (error) {
    console.error(`[${req.correlationId}] Normalization error:`, error)

    // Cleanup on error
    await cleanupFiles(filesToCleanup)

    res.status(500).json({
      success: false,
      error: error.message || 'Document normalization failed'
    })
  }
})

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`[${req.correlationId || 'unknown'}] Server error:`, err)
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Normalizer service running on http://localhost:${PORT}`)
  console.log(`   Health check: http://localhost:${PORT}/health`)
  console.log(`   Normalize: POST http://localhost:${PORT}/normalize`)
  console.log(`   AI Proxy: POST http://localhost:${PORT}/api/analyze/{gemini|openai|anthropic}`)

  // Check for API keys
  const hasGemini = !!process.env.GEMINI_API_KEY
  const hasOpenAI = !!process.env.OPENAI_API_KEY
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY
  console.log(`   API Keys: Gemini=${hasGemini ? '✓' : '✗'} OpenAI=${hasOpenAI ? '✓' : '✗'} Anthropic=${hasAnthropic ? '✓' : '✗'}`)
})
