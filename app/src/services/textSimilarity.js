/**
 * Simple Jaccard similarity between two text strings.
 * Tokenizes on whitespace, compares word overlap.
 * Returns 0-1 score.
 */
export function textSimilarity(textA, textB) {
  if (!textA || !textB) return 0

  const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 2))

  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let intersection = 0
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++
  }

  const union = wordsA.size + wordsB.size - intersection
  return union > 0 ? intersection / union : 0
}

/**
 * Compare pages between two documents.
 * Returns array of { pageNum, similarity, matched } objects.
 */
export function comparePages(oldPages, newPages) {
  const results = []

  for (let i = 0; i < newPages.length; i++) {
    const newText = newPages[i]?.text || ''
    let bestMatch = { pageNum: i + 1, similarity: 0, matchedOldPage: null }

    for (let j = 0; j < oldPages.length; j++) {
      const oldText = oldPages[j]?.text || ''
      const sim = textSimilarity(oldText, newText)

      if (sim > bestMatch.similarity) {
        bestMatch = { pageNum: i + 1, similarity: sim, matchedOldPage: j + 1 }
      }
    }

    results.push(bestMatch)
  }

  return results
}

/** Threshold above which pages are considered "same content" */
export const CARRY_FORWARD_THRESHOLD = 0.85
