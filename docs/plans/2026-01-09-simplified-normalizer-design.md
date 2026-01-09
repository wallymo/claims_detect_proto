# Simplified Document Normalizer Design

**Date:** 2026-01-09
**Status:** Approved, ready for implementation
**Supersedes:** 2026-01-08-document-normalization-pipeline.md

---

## Problem

The original normalizer design processed ALL files (PDF, DOCX, PPTX) through the backend, including:
- PDF → passthrough + render page images
- DOCX/PPTX → convert to PDF + render page images

This is unnecessary because:
1. **PDFs don't need conversion** - AI models handle them directly or via client-side `pdfToImages()`
2. **Page image rendering is redundant** - Claude/OpenAI services already do this client-side

## Solution

Simplify the normalizer to **only handle DOCX/PPTX → PDF conversion**. PDFs bypass the normalizer entirely.

---

## Architecture

**Routing Logic:**
```
User uploads file
  │
  ├─ PDF? ──────────────────────────────► Direct to AI services (no normalizer)
  │                                        ├─ Gemini: sends PDF directly
  │                                        └─ Claude/OpenAI: pdfToImages() client-side
  │
  └─ DOCX/PPTX? ──► Normalizer ──► PDF ──► Direct to AI services (same as above)
```

**Before:**
```
All uploads → Normalizer → canonical_pdf + page_images → AI
```

**After:**
```
PDF uploads → Direct to AI (existing flow)
DOCX/PPTX → Normalizer → PDF → Direct to AI
```

---

## AI Model Native Format Support

| Format | Gemini API | Claude API | OpenAI GPT-4o |
|--------|------------|------------|---------------|
| PDF | ✅ Native | ✅ Native (3.5+) | ❌ Needs → images |
| DOCX | ❌ | ❌ | ❌ |
| PPTX | ❌ | ❌ | ❌ |
| Images | ✅ | ✅ | ✅ |

**Key insight:** None of the AI APIs support DOCX/PPTX directly. All require conversion to PDF or images first.

---

## Frontend Changes

### `MKGClaimsDetector.jsx`

Add file type routing before analysis:

```javascript
const handleAnalyze = async () => {
  let pdfFile = uploadedFile

  // Only normalize DOCX/PPTX - PDFs go straight through
  const needsConversion = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ].includes(uploadedFile.type)

  if (needsConversion) {
    setAnalysisStatus('Converting document...')
    const normalized = await normalizeDocument(uploadedFile, onProgress)
    pdfFile = base64ToBlob(normalized.document.canonical_pdf)
  }

  // pdfFile is now always a PDF - route to AI as before
  const result = await analyzeDocument(pdfFile, onProgress, promptKey, editablePrompt)
  // ...rest unchanged
}
```

### AI Services (No Changes)

| Service | Input | Behavior |
|---------|-------|----------|
| `gemini.js` | PDF File/Blob | Sends PDF directly to Gemini |
| `anthropic.js` | PDF File/Blob | Calls `pdfToImages()`, sends images to Claude |
| `openai.js` | PDF File/Blob | Calls `pdfToImages()`, sends images to GPT-4o |

---

## Backend Changes

### Simplified Response Contract

```javascript
{
  success: true,
  document: {
    document_id: "doc_abc123",
    canonical_pdf: "data:application/pdf;base64,...",
    page_count: 12,
    original_filename: "sales-deck.pptx",
    original_type: "pptx",  // Always "docx" or "pptx" (PDFs don't hit this endpoint)
    conversion_time_ms: 1847
  }
}
```

**Removed from response:**
- `page_images` - client-side handles this
- `file_hash` - not needed for POC
- `warnings` - can add back later if needed

### Files to Modify

| File | Change |
|------|--------|
| `server.js` | Remove image rendering, simplify response |
| `lib/validator.js` | Remove PDF from accepted types (optional) |
| `lib/converter.js` | No change |
| `lib/imageRenderer.js` | **Delete entirely** |

### Dependencies to Remove

```json
// Remove from package.json
"canvas": "...",      // Was for image rendering
"pdfjs-dist": "..."   // Was for image rendering
```

**Benefits:**
- Smaller Docker image (no native canvas dependencies)
- Faster builds
- Less memory usage

### Simplified Dockerfile

```dockerfile
FROM node:20-slim

# Only LibreOffice needed (no canvas build deps)
RUN apt-get update && apt-get install -y \
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

---

## Implementation Checklist

### Backend
- [ ] Remove `lib/imageRenderer.js`
- [ ] Update `server.js` to remove image rendering
- [ ] Remove `page_images` from response
- [ ] Remove `canvas` and `pdfjs-dist` from dependencies
- [ ] Update Dockerfile (simpler, no canvas deps)
- [ ] Test DOCX → PDF conversion
- [ ] Test PPTX → PDF conversion

### Frontend
- [ ] Update `MKGClaimsDetector.jsx` with file type routing
- [ ] Test PDF upload (should skip normalizer)
- [ ] Test DOCX upload (should hit normalizer, then analyze)
- [ ] Test PPTX upload (should hit normalizer, then analyze)
- [ ] Verify all three AI models work

---

## Benefits

1. **Simpler backend** - Just does conversion, no image rendering
2. **Faster PDF processing** - No network round-trip for PDFs
3. **Smaller Docker image** - No canvas native dependencies
4. **Less code to maintain** - Removed imageRenderer.js
5. **Same user experience** - All formats still work

---

## What Stays the Same

- LibreOffice for DOCX/PPTX → PDF conversion
- File validation (size, page count)
- Client-side `pdfToImages()` for Claude/OpenAI
- All AI service interfaces
- PDF rendering in PDFViewer component
- Claim detection and positioning logic
