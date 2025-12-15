# PDF.js Text Matching for Claim Markers

## Problem

Gemini estimates claim positions on PDF pages, but LLMs are imprecise at spatial coordinate estimation. Circles appear "close but not quite" to actual claim locations.

## Solution

Use PDF.js to extract text with exact coordinates from the PDF, then fuzzy-match Gemini's claim text to find precise marker positions.

## How It Works

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Gemini finds   │────▶│  PDF.js extracts │────▶│  Fuzzy match    │
│  claim TEXT     │     │  text + coords   │     │  claim → coord  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

1. **Gemini identifies claims** - text, confidence, page number (no position estimation)
2. **PDF.js extracts text layer** - exact coordinates from PDF binary data
3. **Matcher finds position** - locate first 2-3 words of claim in text layer
4. **Marker placed precisely** - using ground-truth PDF coordinates

## Matching Strategy - First Word Anchoring

**Algorithm:**
1. Take claim text: `"Clinically proven to reduce symptoms by 47%"`
2. Extract first 2-3 words: `"Clinically proven to"`
3. Search PDF.js text items on that page for a match
4. Return the `x, y` coordinates of the first matched word

**Why first 2-3 words:**
- Single words like "The" appear many times
- 2-3 words is usually unique enough
- Handles line breaks gracefully

**Fallback chain:**
1. Match first 3 words → found? Use it
2. Match first 2 words → found? Use it
3. Match first word only → found? Use it
4. No match → `{ x: 50, y: 50 }` (page center)

**Normalization:**
- Case-insensitive
- Normalize whitespace
- Handle hyphenation

## Coordinate System

PDF.js extracts in PDF coordinate space (72 DPI, origin bottom-left). We convert to percentages:

```js
x% = (textX / pageWidth) * 100
y% = (1 - textY / pageHeight) * 100  // Flip Y axis
```

Percentages are zoom/size independent - markers scale correctly at any preview size.

## File Changes

### 1. New: `src/utils/pdfTextExtractor.js`

```js
/**
 * Extract text with positions from a PDF page
 * @param {PDFPageProxy} pdfPage - PDF.js page object
 * @returns {Promise<Array>} - Text items with percentage coordinates
 */
export async function extractTextWithPositions(pdfPage) {
  const textContent = await pdfPage.getTextContent()
  const viewport = pdfPage.getViewport({ scale: 1 })

  return textContent.items
    .filter(item => item.str.trim())
    .map(item => ({
      str: item.str,
      x: (item.transform[4] / viewport.width) * 100,
      y: (1 - item.transform[5] / viewport.height) * 100
    }))
}

/**
 * Find position of claim text on a page
 * @param {string} claimText - The claim text to locate
 * @param {Array} pageTextItems - Text items from extractTextWithPositions
 * @returns {Object|null} - { x, y } percentages or null if not found
 */
export function findClaimPosition(claimText, pageTextItems) {
  const words = claimText.trim().split(/\s+/)

  // Try matching first 3, then 2, then 1 word(s)
  for (const wordCount of [3, 2, 1]) {
    if (words.length < wordCount) continue

    const searchPhrase = words.slice(0, wordCount).join(' ').toLowerCase()

    // Build concatenated text to search through
    let runningText = ''
    for (const item of pageTextItems) {
      const startIndex = runningText.length
      runningText += item.str + ' '

      if (runningText.toLowerCase().includes(searchPhrase)) {
        // Check if this item contains the start of our phrase
        const phraseStart = runningText.toLowerCase().indexOf(searchPhrase)
        if (phraseStart >= startIndex) {
          return { x: item.x, y: item.y }
        }
      }
    }
  }

  return null // No match found
}
```

### 2. Modify: `src/services/gemini.js`

Remove position estimation from prompt. Change output format from:

```json
{
  "claim": "...",
  "confidence": 85,
  "page": 1,
  "position": { "x": 25, "y": 38 }
}
```

To:

```json
{
  "claim": "...",
  "confidence": 85,
  "page": 1
}
```

Remove these lines from the prompt:
- `For the "position" field...`
- `Target the START of the claim text`
- Position field from JSON example

### 3. Modify: `src/components/mkg/PDFViewer.jsx`

Add text extraction and position matching:

```jsx
// New state for cached text positions
const [pageTextCache, setPageTextCache] = useState({})

// Extract text when page renders
useEffect(() => {
  if (!pdf) return

  const extractAllPages = async () => {
    const cache = {}
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      cache[i] = await extractTextWithPositions(page)
    }
    setPageTextCache(cache)
  }

  extractAllPages()
}, [pdf])

// Compute claim positions from text matching
const claimsWithPositions = useMemo(() => {
  if (!Object.keys(pageTextCache).length) return claims

  return claims.map(claim => {
    const pageText = pageTextCache[claim.page]
    if (!pageText) return { ...claim, position: { x: 50, y: 50 } }

    const position = findClaimPosition(claim.text, pageText)
    return { ...claim, position: position || { x: 50, y: 50 } }
  })
}, [claims, pageTextCache])
```

Use `claimsWithPositions` instead of `claims` for filtering and rendering markers.

## What Stays The Same

- Circle visual design (16px, white border, shadow)
- Confidence colors (green ≥0.8, amber ≥0.5, red <0.5)
- Hover/active states
- Bidirectional sync with claim cards
- Pan/zoom alignment

## Benefits

- **Pixel-accurate** - Using actual PDF text coordinates, not AI estimation
- **No extra API cost** - PDF.js runs locally
- **No latency increase** - Text extraction is fast
- **More reliable** - Deterministic matching vs probabilistic guessing
