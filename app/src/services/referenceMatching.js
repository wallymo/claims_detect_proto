import { matchClaimToReferences } from './gemini.js'

/**
 * Extract keywords from text for pre-filtering.
 * Removes common stop words and returns unique meaningful terms.
 */
function extractKeywords(text) {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'can', 'shall', 'this', 'that',
    'these', 'those', 'it', 'its', 'not', 'no', 'than', 'as', 'if',
    'when', 'where', 'which', 'who', 'whom', 'what', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
    'only', 'also', 'very', 'just', 'about', 'above', 'after', 'before',
    'between', 'during', 'through', 'into', 'over', 'under', 'again',
    'further', 'then', 'once', 'here', 'there', 'any', 'up', 'out',
    'so', 'we', 'they', 'he', 'she', 'me', 'him', 'her', 'my', 'your',
    'our', 'their', 'us', 'them'
  ])

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .filter((word, i, arr) => arr.indexOf(word) === i) // unique
}

/**
 * Score a reference against a claim using keyword overlap.
 * Returns a score from 0-1 based on the fraction of claim keywords found in the reference text.
 */
function scoreKeywordOverlap(claimKeywords, referenceText) {
  if (!referenceText || claimKeywords.length === 0) return 0

  const refLower = referenceText.toLowerCase()
  const matches = claimKeywords.filter(keyword => refLower.includes(keyword))
  return matches.length / claimKeywords.length
}

/**
 * Tier 1: Keyword pre-filter.
 * For each claim, score all references by keyword overlap and return the top N.
 */
function preFilterReferences(claimText, references, topN = 8) {
  const claimKeywords = extractKeywords(claimText)

  const scored = references
    .map((ref, index) => ({
      ...ref,
      originalIndex: index,
      keywordScore: scoreKeywordOverlap(claimKeywords, ref.content_text)
    }))
    .filter(ref => ref.keywordScore > 0)
    .sort((a, b) => b.keywordScore - a.keywordScore)
    .slice(0, topN)

  return scored
}

/**
 * Truncate text to a reasonable excerpt length for the AI prompt.
 * Takes first ~2000 chars to keep token usage manageable.
 */
function truncateForPrompt(text, maxChars = 2000) {
  if (!text || text.length <= maxChars) return text
  return text.slice(0, maxChars) + '...'
}

/**
 * Tier 0: Direct fact keyword lookup.
 * Compare claim keywords against pre-extracted fact keywords.
 * If high overlap found, return the matched reference immediately.
 */
function factLookup(claimText, brandFacts) {
  if (!brandFacts || brandFacts.length === 0) return null

  const claimKeywords = extractKeywords(claimText)
  if (claimKeywords.length === 0) return null

  let bestMatch = null
  let bestScore = 0

  for (const refFact of brandFacts) {
    if (!refFact.facts || refFact.facts.length === 0) continue

    for (const fact of refFact.facts) {
      if (!fact.keywords || fact.keywords.length === 0) continue

      // Count how many claim keywords appear in fact keywords
      const factKeywordsLower = fact.keywords.map(k => k.toLowerCase())
      const claimLower = claimText.toLowerCase()
      let overlapCount = 0

      for (const fk of factKeywordsLower) {
        if (claimLower.includes(fk)) overlapCount++
      }

      // Score: fraction of fact keywords found in claim text
      let score = factKeywordsLower.length > 0
        ? overlapCount / factKeywordsLower.length
        : 0

      // Boost confirmed facts, penalize rejected ones
      if (refFact.confirmed_count > 0 && refFact.rejected_count === 0) {
        score *= 1.1 // 10% boost for confirmed references
      } else if (refFact.rejected_count > refFact.confirmed_count) {
        score *= 0.8 // 20% penalty for mostly-rejected references
      }

      if (score > bestScore && score >= 0.6) {
        bestScore = score
        bestMatch = {
          referenceId: refFact.reference_id,
          referenceName: refFact.display_alias,
          fact,
          score
        }
      }
    }
  }

  return bestMatch
}

/**
 * Match a single claim to references using the three-tier pipeline.
 * Tier 0: Direct fact keyword lookup (fast path)
 * Tier 1: Keyword pre-filter to narrow 55 docs -> top 5-8
 * Tier 2: AI matching via Gemini matchClaimToReferences
 */
async function matchSingleClaim(claim, allReferences, brandFacts = []) {
  // Tier 0: Direct fact lookup (fast path)
  const factMatch = factLookup(claim.text, brandFacts)
  if (factMatch && factMatch.score >= 0.75) {
    return {
      ...claim,
      matched: true,
      matchConfidence: factMatch.score,
      matchTier: 0,
      reference: {
        id: factMatch.referenceId,
        name: factMatch.referenceName,
        page: factMatch.fact.page,
        excerpt: factMatch.fact.text
      },
      matchReasoning: `Direct fact match (${(factMatch.score * 100).toFixed(0)}% keyword overlap): "${factMatch.fact.text}"`
    }
  }

  // Tier 1: Pre-filter
  const filtered = preFilterReferences(claim.text, allReferences)

  if (filtered.length === 0) {
    return {
      ...claim,
      matched: false,
      reference: null,
      matchReasoning: 'No keyword overlap with any reference document'
    }
  }

  // Tier 2: AI matching with filtered refs
  const refsForAI = filtered.map(ref => ({
    name: ref.display_alias,
    excerpt: truncateForPrompt(ref.content_text)
  }))

  try {
    const result = await matchClaimToReferences(claim.text, refsForAI)

    if (result.matched && result.referenceIndex) {
      const matchedFilteredRef = filtered[result.referenceIndex - 1]
      if (matchedFilteredRef) {
        return {
          ...claim,
          matched: true,
          matchConfidence: result.confidence,
          reference: {
            id: matchedFilteredRef.id,
            name: result.referenceName || matchedFilteredRef.display_alias,
            page: result.pageInReference,
            excerpt: result.supportingExcerpt
          },
          matchReasoning: result.reasoning
        }
      }
    }

    return {
      ...claim,
      matched: false,
      reference: null,
      matchReasoning: result.reasoning || 'AI could not find a supporting reference'
    }
  } catch (error) {
    console.error(`Matching error for claim ${claim.id}:`, error)
    return {
      ...claim,
      matched: false,
      reference: null,
      matchReasoning: `Matching error: ${error.message}`
    }
  }
}

/**
 * Match all claims to references.
 * Processes claims sequentially to avoid rate limits.
 * Calls onProgress with (currentIndex, totalClaims, currentClaim) for UI updates.
 *
 * @param {Array} claims - Array of detected claims
 * @param {Array} references - Array of reference objects with { id, display_alias, content_text }
 * @param {Function} onProgress - Progress callback (index, total, claim)
 * @param {Array} brandFacts - Pre-extracted facts per reference for Tier 0 lookup
 * @returns {Promise<Array>} - Claims enriched with reference data
 */
export async function matchAllClaimsToReferences(claims, references, onProgress, brandFacts = []) {
  const enrichedClaims = []

  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i]
    onProgress?.(i + 1, claims.length, claim)

    const enriched = await matchSingleClaim(claim, references, brandFacts)
    enrichedClaims.push(enriched)
  }

  return enrichedClaims
}

/**
 * Get matching stats from enriched claims.
 */
export function getMatchingStats(enrichedClaims) {
  const total = enrichedClaims.length
  const matched = enrichedClaims.filter(c => c.matched).length
  const unmatched = total - matched
  const avgConfidence = matched > 0
    ? enrichedClaims
        .filter(c => c.matched && c.matchConfidence)
        .reduce((sum, c) => sum + c.matchConfidence, 0) / matched
    : 0

  return {
    total,
    matched,
    unmatched,
    matchRate: total > 0 ? (matched / total * 100).toFixed(1) : '0.0',
    avgConfidence: (avgConfidence * 100).toFixed(1)
  }
}
