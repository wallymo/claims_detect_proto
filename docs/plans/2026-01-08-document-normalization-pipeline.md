# Document Normalization Pipeline Design

**Date:** 2026-01-08
**Status:** Design approved, ready for implementation
**Goal:** Accept PDF/DOCX/PPTX uploads and normalize to canonical PDF for consistent AI analysis

---

## Problem Statement

Currently, the Claims Detector only accepts PDF files. To support pharmaceutical agencies who work with PowerPoint presentations and Word documents, we need to:

1. Accept DOCX and PPTX uploads
2. Convert them to PDF with 95%+ quality (layout-preserving)
3. Ensure AI models (Gemini, Claude, OpenAI) receive consistent input
4. Maintain accurate claim coordinate positioning regardless of source format

---

## Solution Overview

Add a **document normalizer backend service** that converts all uploads to a canonical PDF format before AI analysis.

**Architecture:**
```
User uploads DOCX/PPTX/PDF
  ↓
Frontend: POST /normalize
  ↓
Backend normalizer service:
  - Validate file (type, size, page count)
  - If PDF: passthrough
  - If DOCX/PPTX: convert using LibreOffice → PDF
  - Render PDF → page images (for Claude/OpenAI vision models)
  ↓
Return: NormalizedDocument { canonical_pdf, page_images, metadata }
  ↓
Frontend: Route to AI model
  - Gemini: uses canonical_pdf
  - Claude/OpenAI: uses page_images
  ↓
Analysis + claim detection (existing flow, unchanged)
```

---

## NormalizedDocument Contract

The normalizer service returns a standard structure consumed by all downstream code:

```javascript
{
  success: true,
  document: {
    // Identity
    document_id: "doc_abc123",           // UUID for this upload
    file_hash: "sha256:a1b2c3...",       // SHA-256 of original file

    // Original file metadata
    original_filename: "sales-deck.pptx",
    original_type: "pptx",               // pdf | docx | pptx
    original_size_bytes: 2048576,

    // Normalized outputs
    canonical_pdf: "data:application/pdf;base64,...",  // Base64-encoded PDF
    page_images: [                       // For vision models (Claude/OpenAI)
      { page: 1, base64: "iVBORw0KG..." },
      { page: 2, base64: "iVBORw0KG..." }
    ],

    // Validation results
    page_count: 12,
    warnings: [                          // Non-fatal conversion issues
      "Slide 3: Embedded video removed during conversion"
    ],

    // Processing metadata
    conversion_time_ms: 1847,
    conversion_method: "libreoffice-7.6" // or "passthrough" for native PDFs
  }
}
```

**Why this contract:**
- `canonical_pdf` → Single source of truth for PDF rendering and Gemini analysis
- `page_images` → Vision models (Claude/OpenAI) get consistent PNG inputs
- `warnings` → Surface conversion issues without blocking analysis
- Metadata → Enables debugging, reproducibility tracking

---

## Backend Service

### Tech Stack

- **Runtime:** Node.js 20+ (Express)
- **Conversion:** LibreOffice 7.6+ headless (`soffice --headless --convert-to pdf`)
- **PDF Rendering:** `pdfjs-dist` (same library used in frontend)
- **Deployment:** Render.com or Railway.app (Docker container, free tier)

**Why LibreOffice:**
- Industry standard (same engine as Google Docs, Microsoft Office Online)
- 95%+ conversion quality with proper layout preservation
- Handles complex PPTX/DOCX features (tables, charts, formatting)
- Open source, free, battle-tested

### File Structure

```
/normalizer-service
├── Dockerfile              # Node.js + LibreOffice base image
├── package.json
├── server.js               # Express app, routing
├── lib/
│   ├── converter.js        # DOCX/PPTX → PDF conversion logic
│   ├── validator.js        # File validation (type, size, page limits)
│   └── imageRenderer.js    # PDF → PNG[] rendering
├── temp/                   # Temporary file storage during conversion
└── .env.example            # Environment variables template
```

### API Endpoint

**POST /normalize**

**Request:**
```http
POST /normalize
Content-Type: multipart/form-data

file: <binary DOCX/PPTX/PDF file>
```

**Response (success):**
```json
{
  "success": true,
  "document": {
    "document_id": "doc_abc123",
    "canonical_pdf": "data:application/pdf;base64,...",
    "page_images": [...],
    "page_count": 12,
    "original_filename": "sales-deck.pptx",
    "original_type": "pptx",
    "conversion_time_ms": 1847
  }
}
```

**Response (error):**
```json
{
  "success": false,
  "error": "File exceeds 100MB limit",
  "max_size_mb": 100
}
```

### Validation Rules

**File Type Validation:**
- Accepted MIME types:
  - `application/pdf`
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX)
  - `application/vnd.openxmlformats-officedocument.presentationml.presentation` (PPTX)
- Reject all others with clear error message
- Use magic byte sniffing, don't trust file extension

**Size Limits:**
- Max file size: 100MB
- Max pages after conversion: 200 pages
- Rationale: Prevents AI API timeouts, controls costs

**Page Count Validation:**
- Extract page/slide count before conversion
- Reject if exceeds 200 pages/slides
- Return error with actual count: `"Document has 250 pages, max is 200"`

### Conversion Logic

**PDF Passthrough:**
```javascript
if (file.mimetype === 'application/pdf') {
  // Already PDF - just validate and return
  const pageCount = await getPDFPageCount(file.path)
  if (pageCount > 200) {
    throw new Error(`PDF has ${pageCount} pages, max is 200`)
  }
  pdfPath = file.path
  conversionMethod = 'passthrough'
}
```

**DOCX/PPTX Conversion:**
```javascript
async function convertToPDF(inputPath, mimeType) {
  const outputDir = path.dirname(inputPath)

  // LibreOffice headless conversion
  const cmd = `soffice --headless --convert-to pdf --outdir ${outputDir} ${inputPath}`

  try {
    await execAsync(cmd, { timeout: 60000 })  // 60s max
  } catch (error) {
    throw new Error(`Conversion failed: ${error.message}`)
  }

  // LibreOffice outputs: input.docx → input.pdf
  const pdfPath = inputPath.replace(/\.(docx|pptx)$/i, '.pdf')

  if (!fs.existsSync(pdfPath)) {
    throw new Error('Conversion produced no output file')
  }

  return pdfPath
}
```

**PDF → Image Rendering:**
```javascript
async function renderPDFToImages(pdfPath) {
  const pdfData = await fs.promises.readFile(pdfPath)
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise

  const images = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2.0 })  // 2x for retina

    const canvas = createCanvas(viewport.width, viewport.height)
    const context = canvas.getContext('2d')

    await page.render({ canvasContext: context, viewport }).promise

    const base64 = canvas.toDataURL('image/png').split(',')[1]
    images.push({ page: i, base64 })
  }

  return images
}
```

### Deployment

**Dockerfile:**
```dockerfile
FROM node:20-bullseye

# Install LibreOffice
RUN apt-get update && apt-get install -y \
    libreoffice \
    libreoffice-writer \
    libreoffice-impress \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
```

**Deploy to Render/Railway:**
1. Connect GitHub repo
2. Select "Docker" build type
3. Set environment variables (if any)
4. Deploy (free tier supports Docker containers)

---

## Frontend Changes

### New Service: `src/services/normalizer.js`

```javascript
const NORMALIZER_API = import.meta.env.VITE_NORMALIZER_URL || 'http://localhost:3001'

/**
 * Normalize a document to canonical PDF format
 * @param {File} file - PDF, DOCX, or PPTX file
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<NormalizedDocument>}
 */
export async function normalizeDocument(file, onProgress) {
  onProgress?.(5, 'Validating document...')

  const formData = new FormData()
  formData.append('file', file)

  onProgress?.(10, 'Uploading to normalizer...')

  const response = await fetch(`${NORMALIZER_API}/normalize`, {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Document normalization failed')
  }

  onProgress?.(20, 'Document normalized')

  const result = await response.json()
  return result
}

/**
 * Convert base64 data URL to Blob for AI analysis
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
```

### Updated `MKGClaimsDetector.jsx`

**File upload validation:**
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

  setUploadedFile(file)
  setUploadState('complete')
}
```

**Updated analysis flow:**
```javascript
const handleAnalyze = async () => {
  if (!uploadedFile) return

  setIsAnalyzing(true)
  setAnalysisComplete(false)
  setAnalysisError(null)
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
    setProcessingTime(Date.now() - startTime)

    // Track usage and cost (existing logic)
    if (result.usage) {
      setLastUsage(result.usage)
      const runCost = result.usage.cost
      setSessionCost(prev => prev + runCost)
      const newTotal = totalCost + runCost
      setTotalCost(newTotal)
      localStorage.setItem('gemini_total_cost', newTotal.toString())
    }

    setAnalysisComplete(true)
  } catch (error) {
    console.error('Analysis error:', error)
    setAnalysisError(error.message)
  } finally {
    setIsAnalyzing(false)
  }
}
```

**What changes:**
- Add normalization step before AI analysis
- Accept DOCX/PPTX in file upload
- Route canonical_pdf (Gemini) vs page_images (Claude/OpenAI)

**What stays the same:**
- Claim processing logic
- PDF viewer rendering
- Cost tracking
- All UI components

### Environment Variables

**Add to `app/.env.local`:**
```bash
VITE_NORMALIZER_URL=http://localhost:3001  # Local dev
# VITE_NORMALIZER_URL=https://normalizer.onrender.com  # Production
```

---

## AI Service Updates

### Gemini Service (no changes needed)

Gemini already accepts PDF files directly. The normalized canonical_pdf works as-is:

```javascript
// src/services/gemini.js - existing code works unchanged
export async function analyzeDocument(pdfFile, onProgress, promptKey, customPrompt) {
  const base64Data = await fileToBase64(pdfFile)

  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{
      role: 'user',
      parts: [
        { text: finalPrompt },
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: base64Data
          }
        }
      ]
    }]
  })
  // ... existing logic
}
```

### Claude/OpenAI Services (signature change)

These services currently convert PDF → images internally. Update them to accept pre-rendered images:

```javascript
// src/services/anthropic.js - updated signature
export async function analyzeDocument(pageImages, onProgress, promptKey, customPrompt) {
  // Remove internal pdfToImages call - receive images directly

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      messages: [{
        role: 'user',
        content: [
          ...pageImages.map(img => ({
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: img.base64
            }
          })),
          { type: 'text', text: selectedPrompt }
        ]
      }]
    })
  })
  // ... existing logic
}
```

**Same change for OpenAI service.**

**Why:**
- Normalizer handles PDF → images once
- No duplicate rendering work
- Consistent images across all vision models

---

## Benefits

### For Users
- **Upload flexibility:** Works with DOCX, PPTX, and PDF
- **Consistent quality:** All uploads normalized to same standard
- **Accurate positioning:** Claim pins land correctly regardless of source format

### For Development
- **Single code path:** All AI models receive standardized input
- **No frontend conversion:** Heavy lifting moved to backend
- **Testable:** Can validate conversions independently of AI analysis

### For POC Success
- **Production-quality conversions:** LibreOffice = 95%+ accuracy
- **Client confidence:** "It works the same for PowerPoint and Word docs"
- **No storage costs:** Temporary files only, auto-cleanup

---

## Future Enhancements

**Skipped for POC, add later:**

1. **Hash-based caching**
   - Store `file_hash → normalized_document` mapping
   - Skip conversion if same file uploaded twice
   - Saves processing time during client demos

2. **Security scanning**
   - ClamAV virus scanning before conversion
   - Reject malicious files
   - Protect backend from exploits

3. **Authentication/Rate limiting**
   - User accounts, API keys
   - Per-user quotas (e.g., 100 conversions/month)
   - Prevents abuse

4. **Persistent storage**
   - Save normalized documents to S3/R2
   - Enable re-analysis without re-upload
   - Audit trail for compliance

5. **Advanced validation**
   - Password-protected file detection
   - Embedded macro warnings
   - Font embedding issues

6. **Conversion quality metrics**
   - Track conversion success rate
   - Log warnings/errors for debugging
   - A/B test LibreOffice vs alternative engines

---

## Implementation Checklist

### Backend Service
- [ ] Initialize Node.js project (`normalizer-service/`)
- [ ] Create Dockerfile with LibreOffice + Node.js
- [ ] Implement `/normalize` endpoint
- [ ] Add file validation (type, size, page count)
- [ ] Implement LibreOffice conversion logic
- [ ] Implement PDF → images rendering
- [ ] Add error handling and cleanup
- [ ] Test locally with sample DOCX/PPTX/PDF files
- [ ] Deploy to Render/Railway free tier
- [ ] Verify production deployment

### Frontend Integration
- [ ] Create `src/services/normalizer.js`
- [ ] Update `MKGClaimsDetector.jsx` file upload to accept DOCX/PPTX
- [ ] Add normalization step to `handleAnalyze()`
- [ ] Update Claude/OpenAI services to accept page_images
- [ ] Add `VITE_NORMALIZER_URL` to environment variables
- [ ] Test end-to-end: DOCX upload → normalize → AI analysis → claim pins
- [ ] Test end-to-end: PPTX upload → normalize → AI analysis → claim pins
- [ ] Test end-to-end: PDF upload → passthrough → AI analysis → claim pins
- [ ] Verify all three AI models work with normalized input

### Testing
- [ ] Test DOCX with complex tables/formatting
- [ ] Test PPTX with charts/images/animations
- [ ] Test PDF passthrough (no conversion)
- [ ] Test file size validation (>100MB rejection)
- [ ] Test page count validation (>200 pages rejection)
- [ ] Test invalid file type rejection
- [ ] Verify claim pins position correctly for all formats

---

## Success Criteria

**POC is successful when:**
1. ✅ User uploads PPTX → system converts to PDF → Gemini analyzes → claims detected
2. ✅ User uploads DOCX → system converts to PDF → Gemini analyzes → claims detected
3. ✅ User uploads PDF → system validates → Gemini analyzes → claims detected (existing behavior)
4. ✅ Claim pins render at correct coordinates for all three input formats
5. ✅ All three AI models (Gemini, Claude, OpenAI) receive appropriate input

**Quality bar:**
- DOCX/PPTX conversions match original layout ≥95%
- No crashes on valid files ≤100MB, ≤200 pages
- Clear error messages for invalid uploads

---

## Deployment Architecture

```
Production:
  Frontend (Vercel/Netlify)
    ↓
  Normalizer Service (Render/Railway)
    ↓
  AI APIs (Gemini/Claude/OpenAI)

Local Dev:
  Frontend: npm run dev (localhost:5173)
  Normalizer: docker-compose up (localhost:3001)
```

**Environment:**
- Frontend env: `VITE_NORMALIZER_URL` (points to normalizer service)
- Backend env: `PORT=3001`, `MAX_FILE_SIZE_MB=100`, `MAX_PAGES=200`

---

## Risk Mitigation

**Risk:** LibreOffice conversion fails on complex documents
**Mitigation:** Test with real client samples during POC, adjust conversion flags

**Risk:** Docker image too large for free tier
**Mitigation:** Use minimal base image (node:20-slim), remove unnecessary LibreOffice components

**Risk:** Conversion timeout on large files
**Mitigation:** Enforce 100MB/200 page limits, set 60s timeout

**Risk:** Backend service costs exceed budget
**Mitigation:** Use free tier (Render/Railway), no persistent storage, auto-cleanup temp files

---

## Questions Resolved

1. **Deployment approach?** → Serverless (Render/Railway free tier)
2. **Conversion quality?** → LibreOffice headless (95%+ accuracy, production-ready)
3. **Storage?** → Temporary only (no persistence for POC)
4. **Multi-model support?** → Yes, keep all three for client testing
5. **Security/caching?** → Deferred to future (noted for production)

---

## Next Steps

1. Create git worktree: `feature/document-normalization`
2. Build backend service (normalizer-service/)
3. Update frontend integration (normalizer.js + MKGClaimsDetector.jsx)
4. Test locally with sample files
5. Deploy backend to Render/Railway
6. Test end-to-end with deployed service
7. Demo to client with DOCX/PPTX uploads
