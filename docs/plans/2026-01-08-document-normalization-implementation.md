# Document Normalization Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build backend normalizer service that converts DOCX/PPTX → PDF and integrates with existing Claims Detector frontend

**Architecture:** Node.js + Express + LibreOffice headless in Docker, exposes POST /normalize endpoint, returns canonical PDF + page images for AI model consumption

**Tech Stack:** Node.js 20, Express, LibreOffice 7.6, pdfjs-dist, canvas, multer, Docker

---

## Task 1: Initialize Backend Service Project

**Files:**
- Create: `normalizer-service/package.json`
- Create: `normalizer-service/server.js`
- Create: `normalizer-service/.gitignore`
- Create: `normalizer-service/.env.example`

**Step 1: Create normalizer-service directory**

```bash
cd /Users/wallymo/claims_detector
mkdir normalizer-service
cd normalizer-service
```

**Step 2: Initialize npm project**

```bash
npm init -y
```

Expected: package.json created

**Step 3: Install dependencies**

```bash
npm install express multer cors uuid
npm install pdfjs-dist@4.0.379 canvas
```

**Step 4: Create .gitignore**

Create `normalizer-service/.gitignore`:
```
node_modules/
temp/
*.log
.env
.DS_Store
```

**Step 5: Create .env.example**

Create `normalizer-service/.env.example`:
```
PORT=3001
MAX_FILE_SIZE_MB=100
MAX_PAGES=200
NODE_ENV=development
```

**Step 6: Create basic server.js**

Create `normalizer-service/server.js`:
```javascript
import express from 'express'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'document-normalizer' })
})

// Start server
app.listen(PORT, () => {
  console.log(`Normalizer service running on http://localhost:${PORT}`)
})
```

**Step 7: Update package.json for ES modules**

Edit `normalizer-service/package.json` - add `"type": "module"` after `"version"`:
```json
{
  "name": "normalizer-service",
  "version": "1.0.0",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  }
}
```

**Step 8: Test server starts**

```bash
npm start
```

Expected output:
```
Normalizer service running on http://localhost:3001
```

Test in another terminal:
```bash
curl http://localhost:3001/health
```

Expected: `{"status":"ok","service":"document-normalizer"}`

**Step 9: Stop server and commit**

Press Ctrl+C to stop server, then:

```bash
git add normalizer-service/
git commit -m "feat(backend): initialize normalizer service with Express server"
```

---

## Task 2: Create File Validator Module

**Files:**
- Create: `normalizer-service/lib/validator.js`

**Step 1: Create lib directory**

```bash
cd /Users/wallymo/claims_detector/normalizer-service
mkdir lib
```

**Step 2: Create validator.js**

Create `normalizer-service/lib/validator.js`:
```javascript
import fs from 'fs/promises'

// Accepted MIME types
const VALID_MIME_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx'
}

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '100')
const MAX_PAGES = parseInt(process.env.MAX_PAGES || '200')

/**
 * Validate uploaded file meets requirements
 * @param {Object} file - Multer file object
 * @returns {Object} { valid: boolean, error?: string, fileType?: string }
 */
export async function validateFile(file) {
  if (!file) {
    return { valid: false, error: 'No file uploaded' }
  }

  // Check file size
  const fileSizeMB = file.size / (1024 * 1024)
  if (fileSizeMB > MAX_FILE_SIZE_MB) {
    return {
      valid: false,
      error: `File size ${fileSizeMB.toFixed(1)}MB exceeds ${MAX_FILE_SIZE_MB}MB limit`
    }
  }

  // Check MIME type
  const fileType = VALID_MIME_TYPES[file.mimetype]
  if (!fileType) {
    return {
      valid: false,
      error: `Unsupported file type: ${file.mimetype}. Only PDF, DOCX, and PPTX are supported.`
    }
  }

  // File passed validation
  return {
    valid: true,
    fileType
  }
}

/**
 * Get page count from PDF using pdfjs-dist
 * @param {string} pdfPath - Path to PDF file
 * @returns {Promise<number>} Page count
 */
export async function getPDFPageCount(pdfPath) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')

  const data = await fs.readFile(pdfPath)
  const pdf = await pdfjsLib.getDocument({ data }).promise

  return pdf.numPages
}

/**
 * Validate page count doesn't exceed limits
 * @param {number} pageCount - Number of pages
 * @returns {Object} { valid: boolean, error?: string }
 */
export function validatePageCount(pageCount) {
  if (pageCount > MAX_PAGES) {
    return {
      valid: false,
      error: `Document has ${pageCount} pages, maximum is ${MAX_PAGES}`
    }
  }

  return { valid: true }
}
```

**Step 3: Commit validator module**

```bash
git add normalizer-service/lib/validator.js
git commit -m "feat(backend): add file validation module for type, size, and page count"
```

---

## Task 3: Create LibreOffice Converter Module

**Files:**
- Create: `normalizer-service/lib/converter.js`

**Step 1: Create converter.js**

Create `normalizer-service/lib/converter.js`:
```javascript
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'

const execAsync = promisify(exec)

/**
 * Convert DOCX/PPTX to PDF using LibreOffice headless
 * @param {string} inputPath - Path to input file
 * @param {string} fileType - File type (docx|pptx)
 * @returns {Promise<string>} Path to converted PDF
 */
export async function convertToPDF(inputPath, fileType) {
  const outputDir = path.dirname(inputPath)

  console.log(`Converting ${fileType} to PDF: ${inputPath}`)

  // LibreOffice headless conversion command
  const cmd = `soffice --headless --convert-to pdf --outdir "${outputDir}" "${inputPath}"`

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 60000,  // 60 second timeout
      maxBuffer: 10 * 1024 * 1024  // 10MB buffer
    })

    if (stderr) {
      console.warn('LibreOffice stderr:', stderr)
    }
    if (stdout) {
      console.log('LibreOffice stdout:', stdout)
    }
  } catch (error) {
    throw new Error(`LibreOffice conversion failed: ${error.message}`)
  }

  // LibreOffice outputs: input.docx → input.pdf
  const baseName = path.basename(inputPath, path.extname(inputPath))
  const pdfPath = path.join(outputDir, `${baseName}.pdf`)

  // Verify output file exists
  try {
    await fs.access(pdfPath)
  } catch {
    throw new Error('Conversion produced no output file')
  }

  console.log(`Conversion complete: ${pdfPath}`)
  return pdfPath
}

/**
 * Cleanup temporary files
 * @param {string[]} filePaths - Paths to delete
 */
export async function cleanupFiles(filePaths) {
  for (const filePath of filePaths) {
    try {
      await fs.unlink(filePath)
      console.log(`Cleaned up: ${filePath}`)
    } catch (error) {
      console.warn(`Failed to cleanup ${filePath}:`, error.message)
    }
  }
}
```

**Step 2: Commit converter module**

```bash
git add normalizer-service/lib/converter.js
git commit -m "feat(backend): add LibreOffice converter module for DOCX/PPTX → PDF"
```

---

## Task 4: Create PDF Image Renderer Module

**Files:**
- Create: `normalizer-service/lib/imageRenderer.js`

**Step 1: Create imageRenderer.js**

Create `normalizer-service/lib/imageRenderer.js`:
```javascript
import fs from 'fs/promises'
import { createCanvas } from 'canvas'

/**
 * Render PDF pages to PNG images
 * @param {string} pdfPath - Path to PDF file
 * @returns {Promise<Array>} Array of { page: number, base64: string }
 */
export async function renderPDFToImages(pdfPath) {
  // Dynamic import for pdfjs-dist (ESM)
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')

  console.log(`Rendering PDF to images: ${pdfPath}`)

  const data = await fs.readFile(pdfPath)
  const pdf = await pdfjsLib.getDocument({ data }).promise

  const images = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2.0 })  // 2x for retina displays

    const canvas = createCanvas(viewport.width, viewport.height)
    const context = canvas.getContext('2d')

    await page.render({
      canvasContext: context,
      viewport
    }).promise

    // Convert canvas to base64 PNG
    const dataURL = canvas.toDataURL('image/png')
    const base64 = dataURL.split(',')[1]

    images.push({
      page: i,
      base64
    })

    console.log(`Rendered page ${i}/${pdf.numPages}`)
  }

  return images
}
```

**Step 2: Commit image renderer module**

```bash
git add normalizer-service/lib/imageRenderer.js
git commit -m "feat(backend): add PDF to PNG image renderer for vision models"
```

---

## Task 5: Implement POST /normalize Endpoint

**Files:**
- Modify: `normalizer-service/server.js`

**Step 1: Add multer configuration and imports**

Edit `normalizer-service/server.js` - replace entire file:
```javascript
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'path'
import fs from 'fs/promises'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { validateFile, getPDFPageCount, validatePageCount } from './lib/validator.js'
import { convertToPDF, cleanupFiles } from './lib/converter.js'
import { renderPDFToImages } from './lib/imageRenderer.js'

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

    // Step 1: Validate file
    const validation = await validateFile(uploadedFile)
    if (!validation.valid) {
      await cleanupFiles(filesToCleanup)
      return res.status(400).json({
        success: false,
        error: validation.error
      })
    }

    const fileType = validation.fileType
    let pdfPath = uploadedFile.path
    let conversionMethod = 'passthrough'

    // Step 2: Convert or passthrough
    if (fileType === 'pdf') {
      // PDF passthrough - just validate page count
      const pageCount = await getPDFPageCount(pdfPath)
      const pageValidation = validatePageCount(pageCount)

      if (!pageValidation.valid) {
        await cleanupFiles(filesToCleanup)
        return res.status(400).json({
          success: false,
          error: pageValidation.error
        })
      }
    } else {
      // DOCX/PPTX - convert to PDF
      conversionMethod = `libreoffice-${fileType}`
      pdfPath = await convertToPDF(uploadedFile.path, fileType)
      filesToCleanup.push(pdfPath)

      // Validate converted PDF page count
      const pageCount = await getPDFPageCount(pdfPath)
      const pageValidation = validatePageCount(pageCount)

      if (!pageValidation.valid) {
        await cleanupFiles(filesToCleanup)
        return res.status(400).json({
          success: false,
          error: pageValidation.error
        })
      }
    }

    // Step 3: Render PDF to images
    const pageImages = await renderPDFToImages(pdfPath)

    // Step 4: Read PDF as base64
    const pdfData = await fs.readFile(pdfPath)
    const canonicalPDF = `data:application/pdf;base64,${pdfData.toString('base64')}`

    // Step 5: Calculate file hash
    const fileHash = crypto
      .createHash('sha256')
      .update(await fs.readFile(uploadedFile.path))
      .digest('hex')

    // Step 6: Build response
    const document = {
      document_id: crypto.randomUUID(),
      file_hash: `sha256:${fileHash}`,
      original_filename: uploadedFile.originalname,
      original_type: fileType,
      original_size_bytes: uploadedFile.size,
      canonical_pdf: canonicalPDF,
      page_images: pageImages,
      page_count: pageImages.length,
      warnings: [],
      conversion_time_ms: Date.now() - startTime,
      conversion_method: conversionMethod
    }

    // Step 7: Cleanup temp files
    await cleanupFiles(filesToCleanup)

    // Step 8: Return normalized document
    res.json({
      success: true,
      document
    })

    console.log(`✅ Normalized ${fileType} → PDF (${pageImages.length} pages) in ${document.conversion_time_ms}ms`)

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
```

**Step 2: Commit endpoint implementation**

```bash
git add normalizer-service/server.js
git commit -m "feat(backend): implement POST /normalize endpoint with full pipeline"
```

---

## Task 6: Create Dockerfile

**Files:**
- Create: `normalizer-service/Dockerfile`
- Create: `normalizer-service/.dockerignore`

**Step 1: Create Dockerfile**

Create `normalizer-service/Dockerfile`:
```dockerfile
FROM node:20-bullseye

# Install LibreOffice
RUN apt-get update && apt-get install -y \
    libreoffice \
    libreoffice-writer \
    libreoffice-impress \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy application code
COPY . .

# Create temp directory
RUN mkdir -p temp

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "server.js"]
```

**Step 2: Create .dockerignore**

Create `normalizer-service/.dockerignore`:
```
node_modules/
temp/
*.log
.env
.DS_Store
.git/
.gitignore
README.md
```

**Step 3: Commit Docker configuration**

```bash
git add normalizer-service/Dockerfile normalizer-service/.dockerignore
git commit -m "feat(backend): add Dockerfile with LibreOffice for deployment"
```

---

## Task 7: Test Backend Locally

**Files:**
- None (testing only)

**Step 1: Start server**

```bash
cd /Users/wallymo/claims_detector/normalizer-service
npm start
```

Expected: Server starts on port 3001

**Step 2: Test health check**

In another terminal:
```bash
curl http://localhost:3001/health
```

Expected: `{"status":"ok","service":"document-normalizer"}`

**Step 3: Test with sample PDF (create test file)**

Create a simple test:
```bash
cd /Users/wallymo/claims_detector
echo "Test PDF normalization" | curl -X POST http://localhost:3001/normalize \
  -F "file=@/path/to/sample.pdf"
```

Expected: JSON response with `success: true` and `document` object

**Note:** For full testing, you'll need actual DOCX/PPTX/PDF sample files. This will be tested in Task 10.

**Step 4: Stop server**

Press Ctrl+C in the server terminal

---

## Task 8: Create Frontend Normalizer Service

**Files:**
- Create: `app/src/services/normalizer.js`

**Step 1: Create normalizer.js**

Create `app/src/services/normalizer.js`:
```javascript
/**
 * Document Normalizer Service
 *
 * Handles communication with backend normalizer service to convert
 * DOCX/PPTX/PDF → canonical PDF + page images
 */

const NORMALIZER_API = import.meta.env.VITE_NORMALIZER_URL || 'http://localhost:3001'

/**
 * Normalize a document to canonical PDF format
 * @param {File} file - PDF, DOCX, or PPTX file
 * @param {Function} onProgress - Progress callback (progress: 0-100, status: string)
 * @returns {Promise<Object>} { success: boolean, document?: NormalizedDocument, error?: string }
 */
export async function normalizeDocument(file, onProgress) {
  onProgress?.(5, 'Validating document...')

  const formData = new FormData()
  formData.append('file', file)

  onProgress?.(10, 'Uploading to normalizer...')

  try {
    const response = await fetch(`${NORMALIZER_API}/normalize`, {
      method: 'POST',
      body: formData
    })

    const result = await response.json()

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Document normalization failed')
    }

    onProgress?.(20, 'Document normalized')

    return result
  } catch (error) {
    console.error('Normalization error:', error)
    throw new Error(error.message || 'Failed to connect to normalizer service')
  }
}

/**
 * Convert base64 data URL to Blob for AI analysis
 * @param {string} dataURL - Base64 data URL (e.g., "data:application/pdf;base64,...")
 * @returns {Blob} Blob object
 */
export function base64ToBlob(dataURL) {
  const [header, base64] = dataURL.split(',')
  const mimeMatch = header.match(/:(.*?);/)
  const mime = mimeMatch ? mimeMatch[1] : 'application/pdf'

  const binary = atob(base64)
  const array = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i)
  }

  return new Blob([array], { type: mime })
}

/**
 * Check if normalizer service is available
 * @returns {Promise<boolean>}
 */
export async function checkNormalizerHealth() {
  try {
    const response = await fetch(`${NORMALIZER_API}/health`)
    const data = await response.json()
    return data.status === 'ok'
  } catch (error) {
    console.error('Normalizer health check failed:', error)
    return false
  }
}
```

**Step 2: Commit normalizer service**

```bash
git add app/src/services/normalizer.js
git commit -m "feat(frontend): add normalizer service for backend integration"
```

---

## Task 9: Update MKGClaimsDetector for Multi-Format Support

**Files:**
- Modify: `app/src/pages/MKGClaimsDetector.jsx`

**Step 1: Add normalizer import**

Edit `app/src/pages/MKGClaimsDetector.jsx` - add import at top of file (around line 15):
```javascript
import { normalizeDocument, base64ToBlob } from '@/services/normalizer'
```

**Step 2: Update file upload validation**

Find the `handleFileSelect` function (around line 140) and replace it:
```javascript
const handleFileSelect = async (event) => {
  const file = event.target.files?.[0]
  if (!file) return

  // Accept PDF, DOCX, PPTX
  const validTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]

  if (!validTypes.includes(file.type)) {
    setAnalysisError('Please upload a PDF, DOCX, or PPTX file')
    return
  }

  setUploadState('uploading')
  setAnalysisError(null)

  // Simulate brief upload progress for UX
  setTimeout(() => {
    setUploadedFile(file)
    setUploadState('complete')
    setAnalysisComplete(false)
    setClaims([])
  }, 500)
}
```

**Step 3: Update handleAnalyze function**

Find the `handleAnalyze` function (around line 178) and replace with:
```javascript
const handleAnalyze = async () => {
  if (!uploadedFile) return

  setIsAnalyzing(true)
  setAnalysisComplete(false)
  setAnalysisError(null)
  setAnalysisProgress(0)
  setAnalysisStatus('Starting...')
  const startTime = Date.now()

  try {
    // STEP 1: Normalize document (NEW)
    setAnalysisStatus('Normalizing document...')
    const normalized = await normalizeDocument(uploadedFile, (progress, status) => {
      setAnalysisProgress(progress)
      setAnalysisStatus(status)
    })

    if (!normalized.success) {
      throw new Error(normalized.error)
    }

    console.log(`✅ Document normalized: ${normalized.document.page_count} pages, ${normalized.document.conversion_method}`)

    // STEP 2: Route to AI model based on selection
    const analyzeDocument = MODEL_ANALYZERS[selectedModel] || analyzeWithGemini
    const promptKey = PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.promptKey || 'all'

    let result
    if (selectedModel === 'gemini-3-pro') {
      // Gemini uses canonical PDF directly
      const pdfBlob = base64ToBlob(normalized.document.canonical_pdf)
      result = await analyzeDocument(pdfBlob, (progress, status) => {
        setAnalysisProgress(progress)
        setAnalysisStatus(status)
      }, promptKey, editablePrompt)
    } else {
      // Claude/OpenAI use page images
      result = await analyzeDocument(normalized.document.page_images, (progress, status) => {
        setAnalysisProgress(progress)
        setAnalysisStatus(status)
      }, promptKey, editablePrompt)
    }

    if (!result.success) {
      throw new Error(result.error || 'Analysis failed')
    }

    // STEP 3: Process claims (existing logic, unchanged)
    const claimsNeedingPositions = result.claims.filter(c => !c.position)
    const claimsWithPositions = claimsNeedingPositions.length > 0 && extractedPages.length > 0
      ? enrichClaimsWithPositions(result.claims, extractedPages)
      : result.claims

    setClaims(addGlobalIndices(claimsWithPositions))

    if (claimsNeedingPositions.length === 0) {
      console.log('✅ All claims have positions from AI - no text matching needed')
    } else {
      console.log(`⚠️ ${claimsNeedingPositions.length}/${result.claims.length} claims missing positions, using text matching fallback`)
    }
    setProcessingTime(Date.now() - startTime)

    // Track usage and cost
    if (result.usage) {
      setLastUsage(result.usage)
      const runCost = result.usage.cost
      setSessionCost(prev => prev + runCost)
      const newTotal = totalCost + runCost
      setTotalCost(newTotal)
      localStorage.setItem('gemini_total_cost', newTotal.toString())
    }

    setAnalysisProgress(100)
    setAnalysisStatus('Complete')
    setAnalysisComplete(true)
  } catch (error) {
    console.error('Analysis error:', error)
    setAnalysisError(error.message)
  } finally {
    setIsAnalyzing(false)
  }
}
```

**Step 4: Commit MKGClaimsDetector updates**

```bash
git add app/src/pages/MKGClaimsDetector.jsx
git commit -m "feat(frontend): integrate normalizer into analysis workflow"
```

---

## Task 10: Update Claude/OpenAI Services for Pre-Rendered Images

**Files:**
- Modify: `app/src/services/anthropic.js`
- Modify: `app/src/services/openai.js`

**Step 1: Update anthropic.js signature**

Edit `app/src/services/anthropic.js` - find the `analyzeDocument` function (around line 200) and update:

**Remove the pdfToImages import and call** - the function now receives images directly:

```javascript
/**
 * Analyze a PDF document and detect claims using Claude Sonnet 4.5
 *
 * @param {Array} pageImages - Pre-rendered page images from normalizer
 * @param {Function} onProgress - Optional progress callback
 * @param {string} promptKey - Prompt key ('all', 'disease', 'drug')
 * @param {string|null} customPrompt - Optional custom prompt override
 * @returns {Promise<Object>} - Result with claims array
 */
export async function analyzeDocument(pageImages, onProgress, promptKey = 'all', customPrompt = null) {
  // Select the appropriate prompt
  let selectedPrompt
  if (customPrompt) {
    selectedPrompt = customPrompt
    console.log(`📋 Using custom prompt (${customPrompt.length} chars)`)
  } else {
    if (promptKey === 'drug') {
      selectedPrompt = MEDICATION_PROMPT
    } else if (promptKey === 'disease') {
      selectedPrompt = DISEASE_STATE_PROMPT
    } else {
      selectedPrompt = CLAIM_DETECTION_PROMPT
    }
    console.log(`📋 Using ${promptKey} prompt for Claude analysis`)
  }

  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('VITE_ANTHROPIC_API_KEY is not set in .env.local')
  }

  onProgress?.(25, 'Sending to Claude Sonnet 4.5...')

  try {
    // Images already provided - no need to convert PDF
    // Anthropic API call using fetch (SDK has CORS issues in browser)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 8192,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              // Send each page as an image
              ...pageImages.map(img => ({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: img.base64
                }
              })),
              {
                type: 'text',
                text: selectedPrompt
              }
            ]
          }
        ]
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()

    onProgress?.(75, 'Processing results...')

    // Extract text from Claude response
    const text = data.content?.[0]?.text || ''

    console.log('🔍 Raw Claude response (first 500 chars):', text?.substring(0, 500))

    // Parse JSON from response (Claude may wrap in markdown code blocks)
    let jsonText = text
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim()
    }

    const result = JSON.parse(jsonText)

    // Transform to frontend format
    const claims = (result.claims || []).map((claim, index) => {
      const pageNumber = Math.max(1, Number(claim.page) || 1)
      const position = (claim.x !== undefined && claim.y !== undefined)
        ? { x: Number(claim.x) || 0, y: Number(claim.y) || 0 }
        : null

      console.log(`📍 Claim ${index + 1}: x=${claim.x}, y=${claim.y}, text="${claim.claim?.slice(0, 50)}..."`)

      return {
        id: `claim_${String(index + 1).padStart(3, '0')}`,
        text: claim.claim,
        confidence: claim.confidence / 100,
        status: 'pending',
        page: pageNumber,
        position
      }
    })

    onProgress?.(95, 'Finalizing...')

    // Extract usage metadata
    const usage = data.usage || {}
    const inputTokens = usage.input_tokens || 0
    const outputTokens = usage.output_tokens || 0
    const cost = calculateCost(ANTHROPIC_MODEL, inputTokens, outputTokens)

    console.log(`✅ Detected ${claims.length} claims`)
    console.log(`💰 Usage: ${inputTokens} input + ${outputTokens} output tokens = $${cost.toFixed(4)}`)

    const pricing = PRICING[ANTHROPIC_MODEL] || PRICING['default']
    return {
      success: true,
      claims,
      usage: {
        model: ANTHROPIC_MODEL,
        modelDisplayName: MODEL_DISPLAY_NAMES[ANTHROPIC_MODEL] || ANTHROPIC_MODEL,
        inputTokens,
        outputTokens,
        cost,
        inputRate: pricing.input,   // $/1M tokens
        outputRate: pricing.output  // $/1M tokens
      }
    }
  } catch (error) {
    console.error('Claude analysis error:', error)
    return {
      success: false,
      error: error.message,
      claims: [],
      usage: null
    }
  }
}
```

**Remove the pdfToImages import at the top** (around line 12):
```javascript
// DELETE THIS LINE:
// import { pdfToImages } from '@/utils/pdfToImages'
```

**Step 2: Update openai.js signature**

Edit `app/src/services/openai.js` - make the same changes:

**Remove the pdfToImages import** (around line 10):
```javascript
// DELETE THIS LINE:
// import { pdfToImages } from '@/utils/pdfToImages'
```

**Update analyzeDocument function** (around line 214):
```javascript
/**
 * Analyze a PDF document and detect claims using GPT-4o
 *
 * @param {Array} pageImages - Pre-rendered page images from normalizer
 * @param {Function} onProgress - Optional progress callback
 * @param {string} promptKey - Prompt key ('all', 'disease', 'drug')
 * @param {string|null} customPrompt - Optional custom prompt override
 * @returns {Promise<Object>} - Result with claims array
 */
export async function analyzeDocument(pageImages, onProgress, promptKey = 'all', customPrompt = null) {
  // Select the appropriate prompt
  let selectedPrompt
  if (customPrompt) {
    selectedPrompt = customPrompt
    console.log(`📋 Using custom prompt (${customPrompt.length} chars)`)
  } else {
    if (promptKey === 'drug') {
      selectedPrompt = MEDICATION_PROMPT
    } else if (promptKey === 'disease') {
      selectedPrompt = DISEASE_STATE_PROMPT
    } else {
      selectedPrompt = CLAIM_DETECTION_PROMPT
    }
    console.log(`📋 Using ${promptKey} prompt for GPT-4o analysis`)
  }

  const client = getOpenAIClient()

  onProgress?.(25, 'Sending to OpenAI GPT-4o...')

  try {
    // Images already provided - no need to convert PDF

    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: selectedPrompt },
            // Send each page as an image
            ...pageImages.map(img => ({
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${img.base64}` }
            }))
          ]
        }
      ],
      max_tokens: 8192,
      temperature: 0,
      response_format: { type: 'json_object' }
    })

    onProgress?.(75, 'Processing results...')

    const text = response.choices?.[0]?.message?.content || ''

    console.log('🔍 Raw OpenAI response (first 500 chars):', text?.substring(0, 500))

    const result = JSON.parse(text)

    // Transform to frontend format
    const claims = (result.claims || []).map((claim, index) => {
      const pageNumber = Math.max(1, Number(claim.page) || 1)
      const position = (claim.x !== undefined && claim.y !== undefined)
        ? { x: Number(claim.x) || 0, y: Number(claim.y) || 0 }
        : null

      console.log(`📍 Claim ${index + 1}: x=${claim.x}, y=${claim.y}, text="${claim.claim?.slice(0, 50)}..."`)

      return {
        id: `claim_${String(index + 1).padStart(3, '0')}`,
        text: claim.claim,
        confidence: claim.confidence / 100,
        status: 'pending',
        page: pageNumber,
        position
      }
    })

    onProgress?.(95, 'Finalizing...')

    // Extract usage metadata
    const usage = response.usage || {}
    const inputTokens = usage.prompt_tokens || 0
    const outputTokens = usage.completion_tokens || 0
    const cost = calculateCost(OPENAI_MODEL, inputTokens, outputTokens)

    console.log(`✅ Detected ${claims.length} claims`)
    console.log(`💰 Usage: ${inputTokens} input + ${outputTokens} output tokens = $${cost.toFixed(4)}`)

    const pricing = PRICING[OPENAI_MODEL] || PRICING['default']
    return {
      success: true,
      claims,
      usage: {
        model: OPENAI_MODEL,
        modelDisplayName: MODEL_DISPLAY_NAMES[OPENAI_MODEL] || OPENAI_MODEL,
        inputTokens,
        outputTokens,
        cost,
        inputRate: pricing.input,   // $/1M tokens
        outputRate: pricing.output  // $/1M tokens
      }
    }
  } catch (error) {
    console.error('OpenAI analysis error:', error)
    return {
      success: false,
      error: error.message,
      claims: [],
      usage: null
    }
  }
}
```

**Step 3: Commit AI service updates**

```bash
git add app/src/services/anthropic.js app/src/services/openai.js
git commit -m "feat(frontend): update Claude/OpenAI services to accept pre-rendered images"
```

---

## Task 11: Add Environment Variable Configuration

**Files:**
- Modify: `app/.env.local` (create if doesn't exist)
- Create: `app/.env.example`

**Step 1: Update .env.local**

Edit or create `app/.env.local`:
```bash
# AI API Keys
VITE_GEMINI_API_KEY=your_gemini_key_here
VITE_ANTHROPIC_API_KEY=your_anthropic_key_here
VITE_OPENAI_API_KEY=your_openai_key_here

# Normalizer Service URL
VITE_NORMALIZER_URL=http://localhost:3001
```

**Step 2: Create .env.example**

Create `app/.env.example`:
```bash
# AI API Keys
VITE_GEMINI_API_KEY=
VITE_ANTHROPIC_API_KEY=
VITE_OPENAI_API_KEY=

# Normalizer Service URL (local dev)
VITE_NORMALIZER_URL=http://localhost:3001
# VITE_NORMALIZER_URL=https://your-normalizer-service.onrender.com  # Production
```

**Step 3: Commit env example**

```bash
git add app/.env.example
git commit -m "docs: add environment variable example for normalizer URL"
```

**Note:** .env.local should already be in .gitignore and won't be committed

---

## Task 12: End-to-End Local Testing

**Files:**
- None (testing workflow)

**Step 1: Start normalizer backend**

Terminal 1:
```bash
cd /Users/wallymo/claims_detector/normalizer-service
npm start
```

Expected: Server runs on http://localhost:3001

**Step 2: Start frontend**

Terminal 2:
```bash
cd /Users/wallymo/claims_detector/app
npm run dev
```

Expected: Frontend runs on http://localhost:5173

**Step 3: Test PDF upload**

1. Open browser: http://localhost:5173/mkg
2. Upload a sample PDF file
3. Click "Analyze Document"
4. Verify:
   - ✅ Progress shows "Normalizing document..."
   - ✅ Analysis completes
   - ✅ Claims detected and displayed
   - ✅ Claim pins render on PDF

**Step 4: Test DOCX upload (if you have LibreOffice installed locally)**

1. Upload a sample DOCX file
2. Click "Analyze Document"
3. Verify:
   - ✅ Conversion happens (check backend logs)
   - ✅ Analysis completes
   - ✅ Claims detected

**Step 5: Test PPTX upload (if you have LibreOffice installed locally)**

1. Upload a sample PPTX file
2. Click "Analyze Document"
3. Verify conversion and analysis

**Step 6: Test all three AI models**

For each model (Gemini, Claude, OpenAI):
1. Select model from dropdown
2. Upload PDF
3. Analyze
4. Verify claims detected

**Step 7: Check error handling**

Test:
- Upload invalid file type (e.g., .xlsx)
- Upload file >100MB
- Verify clear error messages

---

## Task 13: Create Deployment Documentation

**Files:**
- Create: `normalizer-service/README.md`

**Step 1: Create README**

Create `normalizer-service/README.md`:
```markdown
# Document Normalizer Service

Backend service for Claims Detector that normalizes DOCX/PPTX/PDF documents to canonical PDF format.

## Features

- Converts DOCX/PPTX to PDF using LibreOffice headless
- Renders PDF pages to PNG images for vision models (Claude, OpenAI)
- Validates file types, size (100MB max), and page count (200 max)
- Returns normalized document with metadata

## Tech Stack

- Node.js 20
- Express
- LibreOffice 7.6+ (headless)
- pdfjs-dist (PDF rendering)
- canvas (image generation)

## Local Development

### Prerequisites

- Node.js 20+
- LibreOffice installed (for DOCX/PPTX conversion)

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create environment file:
   ```bash
   cp .env.example .env
   ```

3. Start server:
   ```bash
   npm start
   ```

4. Test health check:
   ```bash
   curl http://localhost:3001/health
   ```

## API Documentation

### POST /normalize

Convert DOCX/PPTX/PDF to canonical PDF format.

**Request:**
```http
POST /normalize
Content-Type: multipart/form-data

file: <binary file>
```

**Response (success):**
```json
{
  "success": true,
  "document": {
    "document_id": "uuid",
    "canonical_pdf": "data:application/pdf;base64,...",
    "page_images": [{ "page": 1, "base64": "..." }],
    "page_count": 10,
    "original_filename": "doc.docx",
    "original_type": "docx",
    "conversion_time_ms": 1500
  }
}
```

**Response (error):**
```json
{
  "success": false,
  "error": "Error message"
}
```

**Validation:**
- Max file size: 100MB
- Max pages: 200
- Accepted types: PDF, DOCX, PPTX

## Docker Deployment

### Build image:
```bash
docker build -t normalizer-service .
```

### Run locally:
```bash
docker run -p 3001:3001 normalizer-service
```

## Deploy to Render.com

1. Create new Web Service
2. Connect GitHub repo
3. Select `normalizer-service/` as root directory
4. Build command: (Docker auto-detected)
5. Environment variables:
   - `PORT`: 3001
   - `MAX_FILE_SIZE_MB`: 100
   - `MAX_PAGES`: 200

## Deploy to Railway.app

1. Create new project
2. Add service from GitHub repo
3. Set root directory: `normalizer-service/`
4. Railway auto-detects Dockerfile
5. Set environment variables (same as Render)

## Production Considerations

### Current POC limitations:
- No authentication/rate limiting
- No virus scanning
- No hash-based caching
- Temporary file storage only (no persistence)

### Future enhancements:
- Add ClamAV virus scanning
- Implement hash-based caching (Redis)
- Add user authentication (API keys)
- Persistent storage (S3/R2)
- Rate limiting per user
- Conversion quality metrics

## Troubleshooting

### LibreOffice conversion fails
- Ensure LibreOffice is installed: `soffice --version`
- Check file isn't password-protected
- Verify file isn't corrupted

### Out of memory errors
- Reduce MAX_PAGES limit
- Reduce PDF rendering scale (currently 2.0x)

### Timeout errors
- Increase conversion timeout (currently 60s)
- Check file size and complexity
```

**Step 2: Commit documentation**

```bash
git add normalizer-service/README.md
git commit -m "docs: add normalizer service README with deployment instructions"
```

---

## Task 14: Final Integration Test & Commit

**Files:**
- None (final validation)

**Step 1: Run full test suite**

With both services running:

1. ✅ Test PDF passthrough
2. ✅ Test DOCX conversion (if LibreOffice available)
3. ✅ Test PPTX conversion (if LibreOffice available)
4. ✅ Test Gemini analysis
5. ✅ Test Claude analysis (if API key configured)
6. ✅ Test OpenAI analysis (if API key configured)
7. ✅ Verify claim pins render correctly
8. ✅ Test error cases (invalid file, too large, too many pages)

**Step 2: Check git status**

```bash
cd /Users/wallymo/claims_detector
git status
```

Verify all changes are committed

**Step 3: Create final integration commit**

If any remaining changes:
```bash
git add .
git commit -m "feat: complete document normalization pipeline integration

- Backend normalizer service with LibreOffice conversion
- Frontend integration with multi-format support (PDF/DOCX/PPTX)
- Updated AI services for pre-rendered images
- Full end-to-end workflow tested locally
"
```

**Step 4: Push to remote**

```bash
git push origin main
```

---

## Deployment Steps (Manual - Not Automated)

### Deploy Backend to Render.com

1. Go to https://render.com
2. New → Web Service
3. Connect GitHub repo: `claims_detector`
4. Settings:
   - Name: `claims-normalizer`
   - Root Directory: `normalizer-service/`
   - Environment: Docker
   - Plan: Free
5. Environment Variables:
   - `PORT`: 3001
   - `MAX_FILE_SIZE_MB`: 100
   - `MAX_PAGES`: 200
6. Deploy
7. Copy service URL (e.g., `https://claims-normalizer.onrender.com`)

### Update Frontend Environment

1. Update `app/.env.local`:
   ```bash
   VITE_NORMALIZER_URL=https://claims-normalizer.onrender.com
   ```
2. Restart frontend dev server

### Test Production Backend

```bash
curl https://claims-normalizer.onrender.com/health
```

Expected: `{"status":"ok","service":"document-normalizer"}`

---

## Success Criteria Checklist

**Backend:**
- [x] Normalizer service starts without errors
- [x] /health endpoint returns 200 OK
- [x] POST /normalize accepts PDF and returns canonical_pdf
- [x] DOCX conversion works (requires LibreOffice)
- [x] PPTX conversion works (requires LibreOffice)
- [x] File validation rejects invalid types/sizes
- [x] Page images rendered correctly

**Frontend:**
- [x] File upload accepts PDF/DOCX/PPTX
- [x] Normalization step integrated into analysis flow
- [x] Gemini receives canonical_pdf
- [x] Claude/OpenAI receive page_images
- [x] Claims detected and displayed
- [x] Claim pins render at correct positions
- [x] Error handling shows clear messages

**Integration:**
- [x] End-to-end PDF flow works
- [x] End-to-end DOCX flow works (with LibreOffice)
- [x] End-to-end PPTX flow works (with LibreOffice)
- [x] All three AI models work with normalized input

---

## Notes for Implementation

### LibreOffice Installation

**macOS:**
```bash
brew install --cask libreoffice
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get install libreoffice libreoffice-writer libreoffice-impress
```

**Docker:**
Already included in Dockerfile

### Testing Without LibreOffice

If LibreOffice isn't installed locally:
- PDF passthrough will work
- DOCX/PPTX conversion will fail with clear error
- Full testing requires Docker build OR LibreOffice installation

### Common Issues

**"soffice: command not found"**
- LibreOffice not installed or not in PATH
- Add to PATH: `/Applications/LibreOffice.app/Contents/MacOS` (macOS)

**Conversion timeout**
- File too complex or too large
- Increase timeout in converter.js

**Out of memory**
- Too many pages being rendered
- Reduce scale factor in imageRenderer.js

---

## Future Enhancements (Out of Scope for POC)

1. **Security:**
   - ClamAV virus scanning
   - File signature validation beyond MIME type
   - API key authentication

2. **Performance:**
   - Hash-based caching (Redis)
   - Queue system for long conversions (Bull/BullMQ)
   - Horizontal scaling

3. **Quality:**
   - Conversion quality metrics
   - A/B testing different engines
   - Warning detection (macros, videos, etc.)

4. **Storage:**
   - S3/R2 for persistent artifacts
   - Database for metadata
   - Audit trail

5. **Monitoring:**
   - Error tracking (Sentry)
   - Performance monitoring
   - Usage analytics
