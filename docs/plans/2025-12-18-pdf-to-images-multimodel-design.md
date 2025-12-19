# PDF-to-Images for Multi-Model Pin Accuracy

**Date:** 2025-12-18
**Status:** Approved

## Problem

GPT-4o and Claude Sonnet 4.5 return inaccurate x/y coordinates for claim pins, while Gemini returns accurate positions using the same prompt.

**Root cause:** Gemini has native multimodal PDF support (actually renders and "sees" the page layout). GPT-4o and Claude extract text from PDFs and infer positions from reading order, resulting in:
- Pins clustered vertically in reading order
- Correct column area but wrong precise positions
- Page confusion on multi-page documents

## Solution

Convert PDF pages to PNG images before sending to GPT-4o and Claude. This forces them to use their proven image-vision capabilities.

```
PDF File
    │
    ├──► Gemini: Send as PDF (no change - works perfectly)
    │
    └──► GPT-4o / Claude:
              │
              ▼
         pdf.js renders each page → PNG images
              │
              ▼
         Send images to model with same prompt
```

## Implementation

### 1. New Utility: `src/utils/pdfToImages.js`

```javascript
import * as pdfjsLib from 'pdfjs-dist'

/**
 * Convert PDF to array of base64 PNG images
 * @param {File} pdfFile - The PDF file
 * @param {number} scale - Resolution multiplier (default 2 for crisp text)
 * @returns {Promise<Array<{page: number, base64: string}>>}
 */
export async function pdfToImages(pdfFile, scale = 2) {
  const arrayBuffer = await pdfFile.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const images = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height

    await page.render({
      canvasContext: canvas.getContext('2d'),
      viewport
    }).promise

    images.push({
      page: i,
      base64: canvas.toDataURL('image/png').split(',')[1]
    })
  }

  return images
}
```

**Key decisions:**
- Scale = 2 (~144 DPI) for clear text without massive files
- PNG format for lossless text clarity
- Returns page numbers so models can reference correct page

### 2. OpenAI Service Changes (`openai.js`)

```javascript
// Before: Send PDF as file
content: [
  { type: 'text', text: CLAIM_DETECTION_PROMPT },
  { type: 'file', file: { filename: pdfFile.name, file_data: `data:application/pdf;base64,${base64Data}` } }
]

// After: Send as array of images
import { pdfToImages } from '@utils/pdfToImages'

const pageImages = await pdfToImages(pdfFile)

content: [
  { type: 'text', text: CLAIM_DETECTION_PROMPT },
  ...pageImages.map(img => ({
    type: 'image_url',
    image_url: { url: `data:image/png;base64,${img.base64}` }
  }))
]
```

### 3. Anthropic Service Changes (`anthropic.js`)

```javascript
// Before: Send PDF as document
content: [
  { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } },
  { type: 'text', text: CLAIM_DETECTION_PROMPT }
]

// After: Send as array of images
const pageImages = await pdfToImages(pdfFile)

content: [
  ...pageImages.map(img => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: img.base64 }
  })),
  { type: 'text', text: CLAIM_DETECTION_PROMPT }
]
```

### 4. Gemini Service (`gemini.js`)

**No changes** - continue sending PDF natively since it works perfectly.

## Coordinate System (Unchanged)

The existing percentage-based coordinate system works identically:

| What model sees | What model returns | What frontend does |
|-----------------|-------------------|-------------------|
| Gemini: PDF rendered natively | `x: 25, y: 30` (% of page) | Pin at 25% left, 30% top |
| GPT-4o: PNG image of same page | `x: 25, y: 30` (% of image) | Pin at 25% left, 30% top |

Since the PNG is a rendered version of the same page, percentages map to identical visual locations.

## Edge Cases

### Large PDFs (Many Pages)

```javascript
const MAX_PAGES = 10

const pageImages = await pdfToImages(pdfFile)
if (pageImages.length > MAX_PAGES) {
  console.warn(`PDF has ${pageImages.length} pages, analyzing first ${MAX_PAGES}`)
  pageImages.length = MAX_PAGES
}
```

### Conversion Failures

```javascript
try {
  const pageImages = await pdfToImages(pdfFile)
} catch (error) {
  console.error('PDF conversion failed:', error)
  return {
    success: false,
    error: 'Could not process PDF. Try a different file.',
    claims: []
  }
}
```

### Progress Updates

```javascript
onProgress?.(5, 'Converting PDF pages...')
const pageImages = await pdfToImages(pdfFile)

onProgress?.(25, 'Sending to GPT-4o...')
```

### Token Cost Awareness

```javascript
const totalBytes = pageImages.reduce((sum, img) => sum + img.base64.length, 0)
console.log(`📄 Sending ${pageImages.length} pages (~${Math.round(totalBytes / 1024)}KB)`)
```

## Files Changed

| File | Change |
|------|--------|
| `src/utils/pdfToImages.js` | New - PDF to PNG conversion utility |
| `src/services/openai.js` | Use pdfToImages, update content format |
| `src/services/anthropic.js` | Use pdfToImages, update content format |
| `src/services/gemini.js` | No changes |

## Response Format (Unchanged)

All models return identical JSON:

```json
{
  "claims": [
    { "claim": "20% of patients...", "confidence": 85, "page": 1, "x": 25.0, "y": 14.5 }
  ]
}
```
