import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'path'
import fs from 'fs/promises'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { validateFile, getPDFPageCount, validatePageCount } from './lib/validator.js'
import { convertToPDF, cleanupFiles } from './lib/converter.js'

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
app.use(cors())
app.use(express.json())

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'document-normalizer' })
})

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

    console.log(`✅ Converted ${fileType} → PDF (${pageCount} pages) in ${document.conversion_time_ms}ms`)

  } catch (error) {
    console.error('Normalization error:', error)

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
  console.error('Server error:', err)
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
})
