/**
 * Match model-detected claims to PDF text spans for accurate positioning.
 *
 * Strategy:
 * 1. Normalize claim text and span text for comparison
 * 2. Find spans that contain substantial overlap with claim text
 * 3. If match found, use span's bounding box (source: 'span')
 * 4. If no match, fall back to model's x/y coordinates (source: 'model')
 */

import { logger } from './logger.js'

/**
 * Normalize text for fuzzy matching
 */
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s%$.,]/g, '') // keep letters, numbers, whitespace, common chars
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Calculate overlap score between claim and span text
 * Returns 0-1 where 1 = perfect containment
 */
function overlapScore(claimText, spanText) {
  const claim = normalize(claimText)
  const span = normalize(spanText)

  // Check if span contains claim or vice versa
  if (span.includes(claim)) return 1.0
  if (claim.includes(span)) return span.length / claim.length

  // Check for significant word overlap
  const claimWords = claim.split(' ').filter(w => w.length > 2)
  const spanWords = new Set(span.split(' '))

  if (claimWords.length === 0) return 0

  const matchCount = claimWords.filter(w => spanWords.has(w)).length
  return matchCount / claimWords.length
}

/**
 * Find the best matching line(s) for a claim on a given page
 */
function findMatchingLines(claimText, pageData, minScore = 0.6) {
  const matches = []

  for (const line of pageData.lines) {
    const score = overlapScore(claimText, line.text)
    if (score >= minScore) {
      matches.push({ line, score })
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score)
  return matches
}

/**
 * Compute bounding box from matched lines (as % of page dimensions)
 */
function computeBboxFromLines(matchedLines, pageWidth, pageHeight) {
  if (matchedLines.length === 0) return null

  let minX = Infinity, minY = Infinity
  let maxX = -Infinity, maxY = -Infinity

  for (const { line } of matchedLines) {
    minX = Math.min(minX, line.x)
    minY = Math.min(minY, line.y)
    maxX = Math.max(maxX, line.x + line.width)
    maxY = Math.max(maxY, line.y + line.height)
  }

  // Convert to percentages
  return {
    x: (minX / pageWidth) * 100,
    y: (minY / pageHeight) * 100,
    width: ((maxX - minX) / pageWidth) * 100,
    height: ((maxY - minY) / pageHeight) * 100
  }
}

/**
 * Match claims to spans and enhance position data
 *
 * @param {Array} claims - Claims from model with { text, page, position: { x, y } }
 * @param {Array} extractedPages - Pages from pdfTextExtractor with { pageNum, width, height, lines }
 * @returns {Array} - Claims with enhanced position: { x, y, width?, height?, source: 'span'|'model' }
 */
export function matchClaimsToSpans(claims, extractedPages) {
  if (!extractedPages || extractedPages.length === 0) {
    // No spans available, return claims with model source
    return claims.map(claim => ({
      ...claim,
      position: claim.position ? { ...claim.position, source: 'model' } : null
    }))
  }

  return claims.map(claim => {
    const pageData = extractedPages.find(p => p.pageNum === claim.page)

    if (!pageData || !claim.text) {
      // No page data or claim text, use model coords
      return {
        ...claim,
        position: claim.position ? { ...claim.position, source: 'model' } : null
      }
    }

    // Find matching lines
    const matches = findMatchingLines(claim.text, pageData)

    if (matches.length > 0) {
      // Use span-based positioning
      const bbox = computeBboxFromLines(matches, pageData.width, pageData.height)

      logger.debug(`Span match for "${claim.text.slice(0, 40)}..." score=${matches[0].score.toFixed(2)}, bbox=(${bbox.x.toFixed(1)}, ${bbox.y.toFixed(1)})`)

      return {
        ...claim,
        position: {
          x: bbox.x,
          y: bbox.y + bbox.height / 2, // center Y for pin placement
          width: bbox.width,
          height: bbox.height,
          source: 'span',
          matchScore: matches[0].score
        }
      }
    }

    // No match found, fall back to model coordinates
    logger.debug(`No span match for "${claim.text.slice(0, 40)}..." using model coords`)

    return {
      ...claim,
      position: claim.position ? { ...claim.position, source: 'model' } : null
    }
  })
}
