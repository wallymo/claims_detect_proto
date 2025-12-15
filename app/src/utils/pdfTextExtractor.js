/**
 * PDF Text Extractor - Extract text with positions for claim marker placement
 *
 * Uses PDF.js to get ground-truth text coordinates from the PDF,
 * then fuzzy-matches claim text to find precise marker positions.
 */

/**
 * Extract text with positions from a PDF page
 * @param {PDFPageProxy} pdfPage - PDF.js page object
 * @returns {Promise<Array>} - Text items with percentage coordinates
 */
export async function extractTextWithPositions(pdfPage) {
  const textContent = await pdfPage.getTextContent()
  const viewport = pdfPage.getViewport({ scale: 1 })

  return textContent.items
    .filter(item => item.str && item.str.trim())
    .map(item => ({
      str: item.str,
      // Convert to percentage coordinates
      // transform[4] = x position, transform[5] = y position in PDF coordinates
      x: (item.transform[4] / viewport.width) * 100,
      // PDF y-axis is bottom-up, flip it for top-down screen coordinates
      y: (1 - item.transform[5] / viewport.height) * 100
    }))
}

/**
 * Extract text positions for all pages in a PDF
 * @param {PDFDocumentProxy} pdfDoc - PDF.js document object
 * @returns {Promise<Object>} - Map of page number to text items
 */
export async function extractAllPagesText(pdfDoc) {
  const cache = {}

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i)
    cache[i] = await extractTextWithPositions(page)
  }

  return cache
}

/**
 * Normalize text for matching (lowercase, collapse whitespace)
 * @param {string} text - Text to normalize
 * @returns {string} - Normalized text
 */
function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '') // Remove punctuation for fuzzy matching
    .trim()
}

/**
 * Find position of claim text on a page using first-word anchoring
 * @param {string} claimText - The claim text to locate
 * @param {Array} pageTextItems - Text items from extractTextWithPositions
 * @returns {Object|null} - { x, y } percentages or null if not found
 */
export function findClaimPosition(claimText, pageTextItems) {
  if (!claimText || !pageTextItems?.length) return null

  const words = claimText.trim().split(/\s+/)
  if (!words.length) return null

  // Try matching first 3, then 2, then 1 word(s)
  for (const wordCount of [3, 2, 1]) {
    if (words.length < wordCount) continue

    const searchPhrase = normalizeText(words.slice(0, wordCount).join(' '))
    if (!searchPhrase) continue

    // Build concatenated text from page items and track positions
    let runningText = ''
    const itemPositions = [] // Track where each item starts in runningText

    for (const item of pageTextItems) {
      itemPositions.push({
        startIndex: runningText.length,
        x: item.x,
        y: item.y
      })
      runningText += normalizeText(item.str) + ' '
    }

    // Search for the phrase
    const phraseIndex = runningText.indexOf(searchPhrase)
    if (phraseIndex !== -1) {
      // Find which text item contains the start of our phrase
      for (let i = itemPositions.length - 1; i >= 0; i--) {
        if (itemPositions[i].startIndex <= phraseIndex) {
          return {
            x: Math.max(0, Math.min(100, itemPositions[i].x)),
            y: Math.max(0, Math.min(100, itemPositions[i].y))
          }
        }
      }
    }
  }

  return null // No match found
}

/**
 * Add positions to claims by matching against PDF text
 * @param {Array} claims - Claims from Gemini (with page numbers)
 * @param {Object} pageTextCache - Map of page number to text items
 * @returns {Array} - Claims with position data added
 */
export function addPositionsToClaims(claims, pageTextCache) {
  if (!claims?.length || !pageTextCache) return claims

  return claims.map(claim => {
    const pageText = pageTextCache[claim.page]

    if (!pageText) {
      // No text data for this page, use center fallback
      return { ...claim, position: { x: 50, y: 50 } }
    }

    const position = findClaimPosition(claim.text, pageText)

    return {
      ...claim,
      position: position || { x: 50, y: 50 } // Center fallback if no match
    }
  })
}
