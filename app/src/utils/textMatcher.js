/**
 * Match claim text against extracted PDF text to find position
 * Returns x/y as percentages (0-100) of page dimensions
 */

/**
 * Normalize text for fuzzy matching
 */
function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim()
}

/**
 * Find the position of a claim on a specific page
 * @param {string} claimText - The claim text to find
 * @param {number} pageNum - Page number (1-indexed)
 * @param {Array} extractedPages - Output from extractTextWithPositions
 * @returns {{ x: number, y: number } | null} - Position as percentages
 */
export function findClaimPosition(claimText, pageNum, extractedPages) {
  const page = extractedPages.find(p => p.pageNum === pageNum)
  if (!page || !page.items.length) return null

  const normalizedClaim = normalizeText(claimText)

  // Extract first few significant words for matching
  const searchWords = normalizedClaim
    .split(' ')
    .filter(w => w.length > 3) // Skip short words
    .slice(0, 4)               // First 4 significant words

  if (searchWords.length === 0) return null

  // Build full page text with position tracking
  let bestMatch = null
  let bestScore = 0

  for (const item of page.items) {
    const normalizedItem = normalizeText(item.str)
    if (!normalizedItem) continue

    // Count how many search words appear in this item
    let score = 0
    for (const word of searchWords) {
      if (normalizedItem.includes(word)) {
        score++
      }
    }

    // If this item contains the first search word, boost score
    if (normalizedItem.includes(searchWords[0])) {
      score += 2
    }

    if (score > bestScore) {
      bestScore = score
      bestMatch = item
    }
  }

  // Require at least 2 matching words (or 1 + first word bonus)
  if (bestScore >= 2 && bestMatch) {
    return {
      x: (bestMatch.x / page.width) * 100,
      y: (bestMatch.y / page.height) * 100
    }
  }

  // Fallback: return null (caller can decide default)
  return null
}

/**
 * Enrich an array of claims with position data
 * @param {Array} claims - Claims from Gemini (must have text and page)
 * @param {Array} extractedPages - Output from extractTextWithPositions
 * @returns {Array} - Claims with position: { x, y } added
 */
export function enrichClaimsWithPositions(claims, extractedPages) {
  return claims.map((claim, index) => {
    const position = findClaimPosition(claim.text, claim.page, extractedPages)

    return {
      ...claim,
      position: position || {
        // Fallback: stagger vertically on left side of page
        x: 15,
        y: 10 + (index * 8) % 80
      }
    }
  })
}
