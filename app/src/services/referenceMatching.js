import { matchClaimToReferences, extractSupportingQuote } from './gemini.js'
import { verifyQuote } from '@/utils/quoteVerifier.js'
import * as api from './api.js'
import { logger } from '@/utils/logger'

function parseBooleanEnvFlag(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function parsePositiveIntEnv(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseBoundedFloatEnv(value, fallback, min = 0, max = 1) {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

const viteEnv = typeof import.meta !== 'undefined' ? import.meta.env : {}

const MATCHING_HYBRID_ENABLED = parseBooleanEnvFlag(viteEnv.VITE_MATCHING_HYBRID_ENABLED, true)
const MATCHING_SEMANTIC_DIRECT_FALLBACK_ENABLED = parseBooleanEnvFlag(
  viteEnv.VITE_MATCHING_SEMANTIC_DIRECT_FALLBACK_ENABLED,
  true
)

const DEFAULT_TOP_K = parsePositiveIntEnv(viteEnv.VITE_MATCHING_TOPK, 20)
const DEFAULT_CANDIDATE_POOL = parsePositiveIntEnv(viteEnv.VITE_MATCHING_CANDIDATE_POOL, 40)
const DEFAULT_MATCHING_CONCURRENCY = parsePositiveIntEnv(viteEnv.VITE_MATCHING_CONCURRENCY, 4)
const DEFAULT_TIER2_MAX_REFERENCES = parsePositiveIntEnv(viteEnv.VITE_MATCHING_TIER2_MAX_REFERENCES, 5)

const SEMANTIC_DIRECT_FALLBACK_MIN_SEMANTIC = parseBoundedFloatEnv(
  viteEnv.VITE_MATCHING_SEMANTIC_DIRECT_MIN_SEMANTIC,
  0.82
)
const SEMANTIC_DIRECT_FALLBACK_MIN_HYBRID = parseBoundedFloatEnv(
  viteEnv.VITE_MATCHING_SEMANTIC_DIRECT_MIN_HYBRID,
  0.70
)
const SEMANTIC_DIRECT_FALLBACK_MIN_MARGIN = parseBoundedFloatEnv(
  viteEnv.VITE_MATCHING_SEMANTIC_DIRECT_MIN_MARGIN,
  0.01
)

const HYBRID_WEIGHTS = {
  semantic: 0.75,
  keyword: 0.15,
  numeric: 0.10
}

const STOP_WORDS = new Set([
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

function roundMs(value) {
  return Math.round(value || 0)
}

function summarizeDurations(durations) {
  if (!durations.length) {
    return {
      count: 0,
      min: 0,
      avg: 0,
      p95: 0,
      max: 0
    }
  }

  const sorted = [...durations].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, ms) => acc + ms, 0)
  const percentileIndex = Math.max(0, Math.ceil(sorted.length * 0.95) - 1)

  return {
    count: sorted.length,
    min: roundMs(sorted[0]),
    avg: roundMs(sum / sorted.length),
    p95: roundMs(sorted[percentileIndex]),
    max: roundMs(sorted[sorted.length - 1])
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function resolveConcurrency(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return clamp(parsed, 1, 12)
}

function normalizeAlias(text) {
  if (!text) return ''
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function resolveMatchConfidence(rawConfidence, fallback) {
  if (Number.isFinite(rawConfidence)) {
    if (rawConfidence > 1 && rawConfidence <= 100) {
      return clamp(rawConfidence / 100, 0, 1)
    }
    return clamp(rawConfidence, 0, 1)
  }

  if (typeof rawConfidence === 'string') {
    const parsed = Number.parseFloat(rawConfidence)
    if (Number.isFinite(parsed)) {
      if (parsed > 1 && parsed <= 100) {
        return clamp(parsed / 100, 0, 1)
      }
      return clamp(parsed, 0, 1)
    }
  }

  return fallback
}

function accumulateMatchingUsage(telemetry, usage) {
  if (!telemetry || !usage) return
  telemetry.matching_ai_calls = (telemetry.matching_ai_calls || 0) + 1
  telemetry.matching_ai_input_tokens = (telemetry.matching_ai_input_tokens || 0) + (usage.inputTokens || 0)
  telemetry.matching_ai_output_tokens = (telemetry.matching_ai_output_tokens || 0) + (usage.outputTokens || 0)
  telemetry.matching_ai_cost = (telemetry.matching_ai_cost || 0) + (usage.cost || 0)
}

function parseReferenceIndex(value, maxCandidates) {
  if (!maxCandidates || maxCandidates < 1 || value === null || value === undefined) {
    return null
  }
  if (Number.isFinite(value)) {
    const parsed = Math.trunc(value)
    return parsed >= 1 && parsed <= maxCandidates ? parsed : null
  }
  const asText = String(value).trim()
  if (!asText) return null
  const direct = Number.parseInt(asText, 10)
  if (Number.isFinite(direct) && direct >= 1 && direct <= maxCandidates) return direct
  const extracted = asText.match(/\d+/)
  if (extracted) {
    const parsed = Number.parseInt(extracted[0], 10)
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= maxCandidates) return parsed
  }
  return null
}

function selectAICandidate(result, candidates) {
  if (!result?.matched || !Array.isArray(candidates) || candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  const index = parseReferenceIndex(result.referenceIndex, candidates.length)
  if (index) return candidates[index - 1]

  const resultName = normalizeAlias(result.referenceName)
  if (resultName) {
    const exactMatch = candidates.find(c => normalizeAlias(c.display_alias || c.name) === resultName)
    if (exactMatch) return exactMatch
    const fuzzyMatch = candidates.find(c => {
      const n = normalizeAlias(c.display_alias || c.name)
      return n.includes(resultName) || resultName.includes(n)
    })
    if (fuzzyMatch) return fuzzyMatch
  }
  return null
}

function extractNumericTokens(text) {
  if (!text) return []

  const numeric = new Set()
  const normalized = text.toLowerCase()

  const numberMatches = normalized.match(/\b\d+(?:\.\d+)?%?\b/g) || []
  numberMatches.forEach(token => numeric.add(token))

  const pValueMatches = normalized.match(/\bp\s*[<=>]\s*0?\.\d+\b/g) || []
  pValueMatches.forEach(token => numeric.add(token.replace(/\s+/g, '')))

  const sampleSizeMatches = normalized.match(/\bn\s*[=:]?\s*\d+\b/g) || []
  sampleSizeMatches.forEach(token => numeric.add(token.replace(/\s+/g, '')))

  return [...numeric]
}

function scoreKeywordOverlap(claimKeywords, referenceText) {
  if (!referenceText || claimKeywords.length === 0) return 0
  const refLower = referenceText.toLowerCase()
  const matches = claimKeywords.filter(keyword => refLower.includes(keyword))
  return matches.length / claimKeywords.length
}

function scoreNumericOverlap(claimNumericTokens, referenceText) {
  if (!referenceText || claimNumericTokens.length === 0) return 0
  const refLower = referenceText.toLowerCase()
  const matches = claimNumericTokens.filter(token => refLower.includes(token))
  return matches.length / claimNumericTokens.length
}

function rerankSemanticResults(claimText, searchResults) {
  const claimKeywords = extractKeywords(claimText)
  const claimNumericTokens = extractNumericTokens(claimText)

  const reranked = searchResults.map(result => {
    const semantic = clamp(result.similarity || 0, 0, 1)
    const keyword = clamp(scoreKeywordOverlap(claimKeywords, result.passage_text), 0, 1)
    const numeric = clamp(scoreNumericOverlap(claimNumericTokens, result.passage_text), 0, 1)
    const hybrid = (
      semantic * HYBRID_WEIGHTS.semantic +
      keyword * HYBRID_WEIGHTS.keyword +
      numeric * HYBRID_WEIGHTS.numeric
    )

    return {
      ...result,
      semantic_score: semantic,
      keyword_overlap: keyword,
      numeric_overlap: numeric,
      hybrid_score: clamp(hybrid, 0, 1)
    }
  })

  reranked.sort((a, b) => {
    if (b.hybrid_score !== a.hybrid_score) return b.hybrid_score - a.hybrid_score
    return (b.semantic_score || 0) - (a.semantic_score || 0)
  })

  return reranked
}

function enrichSemanticOnlyResults(searchResults) {
  return [...searchResults]
    .map(result => {
      const semantic = clamp(result.similarity || 0, 0, 1)
      return {
        ...result,
        semantic_score: semantic,
        keyword_overlap: 0,
        numeric_overlap: 0,
        hybrid_score: semantic
      }
    })
    .sort((a, b) => (b.semantic_score || 0) - (a.semantic_score || 0))
}

function createFallbackReferenceLoader(allReferences, telemetry) {
  let allReferencesWithTextPromise = null

  return async function getFallbackReferencesWithText() {
    if (!allReferencesWithTextPromise) {
      const fetchStartedAt = Date.now()

      allReferencesWithTextPromise = (async () => {
        const refsWithText = await Promise.all(
          allReferences.map(async (ref) => {
            try {
              const textData = await api.fetchReferenceText(ref.id)
              return {
                id: ref.id,
                display_alias: ref.display_alias,
                content_text: textData.content_text
              }
            } catch {
              return {
                id: ref.id,
                display_alias: ref.display_alias,
                content_text: null
              }
            }
          })
        )

        return refsWithText.filter(ref => ref.content_text)
      })()
        .finally(() => {
          telemetry.reference_fetch_ms += Date.now() - fetchStartedAt
        })
    }

    return allReferencesWithTextPromise
  }
}

// ========== V2 Pipeline Helpers ==========

const FACT_ANCHOR_MIN_SIMILARITY = 0.90
const FACT_ANCHOR_MIN_KEYWORD_OVERLAP = 2
const TIER2_MAX_REFERENCES = Math.max(1, Math.min(DEFAULT_TIER2_MAX_REFERENCES, 8))
const EVIDENCE_TYPE_PRIORITY = {
  table_cell: 4,
  text_quote: 3,
  figure_caption: 2,
  chart_label: 1
}

function normalizeEvidenceType(value) {
  if (!value) return 'text_quote'
  const normalized = String(value).trim().toLowerCase()
  if (normalized in EVIDENCE_TYPE_PRIORITY) return normalized
  return 'text_quote'
}

function getEvidenceTypePriority(value) {
  return EVIDENCE_TYPE_PRIORITY[normalizeEvidenceType(value)] || 0
}

function rankEvidenceQuotes(quotes) {
  if (!Array.isArray(quotes)) return []
  return [...quotes]
    .filter(q => typeof q?.text === 'string' && q.text.trim().length > 0)
    .map((quote, index) => ({
      ...quote,
      evidence_type: normalizeEvidenceType(quote.evidence_type),
      _index: index
    }))
    .sort((a, b) => {
      const typeDiff = getEvidenceTypePriority(b.evidence_type) - getEvidenceTypePriority(a.evidence_type)
      if (typeDiff !== 0) return typeDiff
      return a._index - b._index
    })
}

function resolveExtractionMatchConfidence(verificationStatus, evidenceType) {
  const base = verificationStatus === 'verified' ? 0.95 : 0.80
  const normalizedType = normalizeEvidenceType(evidenceType)

  if (normalizedType === 'table_cell') return clamp(base + 0.02, 0, 1)
  if (normalizedType === 'figure_caption') return clamp(base - 0.01, 0, 1)
  if (normalizedType === 'chart_label') return clamp(base - 0.05, 0, 1)
  return base
}

function applyMatchConfidenceToClaim(claim) {
  if (!claim?.matched) return claim
  if (!Number.isFinite(claim.matchConfidence) || !Number.isFinite(claim.confidence)) return claim
  if (claim.matchConfidence >= 0.90) return claim

  const loweredConfidence = clamp(Math.min(claim.confidence, claim.matchConfidence), 0, 1)
  if (loweredConfidence === claim.confidence) return claim

  return {
    ...claim,
    confidence: loweredConfidence
  }
}

function buildSemanticDirectFallbackMatch(allReferences, topCandidate, leadMargin) {
  if (!MATCHING_SEMANTIC_DIRECT_FALLBACK_ENABLED || !topCandidate) return null

  const semantic = clamp(topCandidate.semantic_score || 0, 0, 1)
  const hybrid = clamp(topCandidate.hybrid_score || semantic, 0, 1)
  const margin = Number.isFinite(leadMargin) ? Math.max(0, leadMargin) : 0

  const passesScoreGate = (
    semantic >= SEMANTIC_DIRECT_FALLBACK_MIN_SEMANTIC ||
    hybrid >= SEMANTIC_DIRECT_FALLBACK_MIN_HYBRID
  )
  const passesMarginGate = (
    margin >= SEMANTIC_DIRECT_FALLBACK_MIN_MARGIN ||
    semantic >= SEMANTIC_DIRECT_FALLBACK_MIN_SEMANTIC + 0.03 ||
    hybrid >= SEMANTIC_DIRECT_FALLBACK_MIN_HYBRID + 0.03
  )

  if (!passesScoreGate || !passesMarginGate) return null

  const refObj = Array.isArray(allReferences)
    ? allReferences.find((ref) => (
      ref.id === topCandidate.reference_id ||
      normalizeAlias(ref.display_alias || ref.name) === normalizeAlias(topCandidate.display_alias)
    ))
    : null

  return {
    matched: true,
    matchConfidence: hybrid,
    matchTier: 'semantic-direct-fallback',
    reference: {
      id: refObj?.id || topCandidate.reference_id,
      name: topCandidate.display_alias || refObj?.display_alias || refObj?.name || null,
      page: topCandidate.page_estimate ?? null,
      excerpt: typeof topCandidate.passage_text === 'string'
        ? topCandidate.passage_text.slice(0, 400)
        : null,
      charStart: topCandidate.start_char ?? null,
      charEnd: topCandidate.end_char ?? null,
      verificationStatus: 'unverified'
    },
    matchReasoning: `No verified quote found; using high-confidence semantic fallback (hybrid ${(hybrid * 100).toFixed(0)}%, semantic ${(semantic * 100).toFixed(0)}%, lead +${(margin * 100).toFixed(0)}).`
  }
}

async function factAnchoredSearch(claim, brandId, telemetry) {
  try {
    const response = await api.searchFacts(brandId, claim.text)
    const results = response.results || []
    if (results.length === 0) return null

    const top = results[0]
    const originalSimilarity = top.similarity
    let adjustedSimilarity = originalSimilarity
    if (top.confirmed_count > 0) {
      adjustedSimilarity += Math.min(0.05, top.confirmed_count * 0.01)
    }
    if (top.rejected_count > (top.confirmed_count || 0)) {
      adjustedSimilarity -= Math.min(0.10, (top.rejected_count - (top.confirmed_count || 0)) * 0.02)
    }
    if (!Number.isFinite(adjustedSimilarity) || adjustedSimilarity < FACT_ANCHOR_MIN_SIMILARITY) return null

    // Check keyword overlap — need at least 2 shared keywords or 1 shared numeric
    const claimKeywords = extractKeywords(claim.text)
    const claimNumerics = extractNumericTokens(claim.text)
    const factTexts = (top.facts || []).map(f => f.text || '').join(' ').toLowerCase()

    const keywordMatches = claimKeywords.filter(kw => factTexts.includes(kw))
    const numericMatches = claimNumerics.filter(n => factTexts.includes(n))

    if (keywordMatches.length < FACT_ANCHOR_MIN_KEYWORD_OVERLAP && numericMatches.length === 0) {
      return null
    }

    // Find the best matching individual fact
    const bestFact = (top.facts || []).reduce((best, fact) => {
      const factLower = (fact.text || '').toLowerCase()
      const score = claimKeywords.filter(kw => factLower.includes(kw)).length
      return score > (best?.score || 0) ? { ...fact, score } : best
    }, null)

    telemetry.fact_anchored_count = (telemetry.fact_anchored_count || 0) + 1
    return {
      matched: true,
      matchConfidence: adjustedSimilarity,
      matchTier: 'fact-anchored',
      reference: {
        id: top.reference_id,
        name: top.display_alias,
        page: bestFact?.page || null,
        excerpt: bestFact?.text || top.facts?.[0]?.text || null,
        charStart: null,
        charEnd: null,
        verificationStatus: 'fact-anchored'
      },
      matchReasoning: `Fact-anchored match (similarity ${(top.similarity * 100).toFixed(0)}%, ${keywordMatches.length} keywords, ${numericMatches.length} numerics)`,
      _diag: {
        similarity: Number(top.similarity?.toFixed(3)),
        originalSimilarity: Number(originalSimilarity?.toFixed(3)),
        adjustedSimilarity: Number(adjustedSimilarity?.toFixed(3)),
        keywordMatches: keywordMatches.length,
        numericMatches: numericMatches.length,
        refName: top.display_alias
      }
    }
  } catch (err) {
    logger.warn('Fact-anchored search failed, falling through:', err.message)
    return null
  }
}

function groupByReference(rerankedResults, maxRefs = 3) {
  const refMap = new Map()
  for (const result of rerankedResults) {
    const refId = result.reference_id
    if (!refMap.has(refId)) {
      refMap.set(refId, {
        reference_id: refId,
        display_alias: result.display_alias,
        bestHybridScore: result.hybrid_score,
        bestSemanticScore: result.semantic_score
      })
    }
  }
  return Array.from(refMap.values())
    .sort((a, b) => b.bestHybridScore - a.bestHybridScore)
    .slice(0, maxRefs)
}

async function fullReferenceExtraction(claim, candidateRefs, allReferences, telemetry, diagnostics = []) {
  for (const candidateRef of candidateRefs) {
    const refDiag = {
      tier: '2-extraction',
      refName: candidateRef.display_alias,
      refId: candidateRef.reference_id
    }

    try {
      const refObj = allReferences.find(r => r.id === candidateRef.reference_id)
      if (!refObj) {
        refDiag.result = 'ref-not-found'
        diagnostics.push(refDiag)
        continue
      }

      const textData = await api.fetchReferenceText(candidateRef.reference_id)
      if (!textData?.content_text) {
        refDiag.result = 'no-text'
        diagnostics.push(refDiag)
        continue
      }

      refDiag.textLength = textData.content_text.length
      telemetry.extraction_ai_calls = (telemetry.extraction_ai_calls || 0) + 1

      const extractionResult = await extractSupportingQuote(
        claim.text,
        textData.content_text,
        candidateRef.display_alias
      )

      accumulateMatchingUsage(telemetry, extractionResult?.usage)

      const result = extractionResult?.result
      if (!result || !result.supported || !result.quotes?.length) {
        refDiag.result = 'not-supported'
        refDiag.supported = result?.supported ?? null
        refDiag.quoteCount = result?.quotes?.length ?? 0
        refDiag.reasoning = result?.reasoning?.slice(0, 200) ?? null
        diagnostics.push(refDiag)
        continue
      }

      // Tier 2b: Verify the quote
      const rankedQuotes = rankEvidenceQuotes(result.quotes)
      let matchedQuote = null
      let matchedVerification = null

      for (let quoteIndex = 0; quoteIndex < rankedQuotes.length; quoteIndex++) {
        const quote = rankedQuotes[quoteIndex]
        const verification = verifyQuote(quote.text, textData.content_text)
        if (quoteIndex === 0) {
          refDiag.quoteLength = quote.text?.length ?? 0
          refDiag.verificationStatus = verification.status
          refDiag.quotePreview = quote.text?.slice(0, 120) ?? null
          refDiag.evidenceType = quote.evidence_type
        }
        if (verification.status !== 'unverified') {
          matchedQuote = quote
          matchedVerification = verification
          break
        }
      }

      if (!matchedQuote || !matchedVerification) {
        telemetry.unverified_quotes = (telemetry.unverified_quotes || 0) + 1
        refDiag.result = 'unverified'
        diagnostics.push(refDiag)
        continue
      }

      // Verified or partial match
      let pageEstimate = matchedQuote.page_estimate
      if (matchedVerification.charOffset != null) {
        const boundaries = textData.page_boundaries
        if (Array.isArray(boundaries) && boundaries.length > 0) {
          const found = boundaries.find(b => matchedVerification.charOffset >= b.startChar && matchedVerification.charOffset < b.endChar)
          pageEstimate = found ? found.page : Math.floor(matchedVerification.charOffset / (textData.content_text.length / textData.page_count)) + 1
        } else if (textData.page_count) {
          pageEstimate = Math.floor(matchedVerification.charOffset / (textData.content_text.length / textData.page_count)) + 1
        }
      }

      telemetry.verified_quotes = (telemetry.verified_quotes || 0) + 1
      refDiag.result = 'matched'
      refDiag.matchTier = matchedVerification.status === 'verified' ? 'verified-extraction' : 'partial-extraction'
      refDiag.matchedEvidenceType = matchedQuote.evidence_type
      diagnostics.push(refDiag)

      return {
        matched: true,
        matchConfidence: resolveExtractionMatchConfidence(matchedVerification.status, matchedQuote.evidence_type),
        matchTier: matchedVerification.status === 'verified' ? 'verified-extraction' : 'partial-extraction',
        reference: {
          id: candidateRef.reference_id,
          name: candidateRef.display_alias,
          page: pageEstimate,
          excerpt: matchedQuote.text,
          evidenceType: matchedQuote.evidence_type,
          charStart: matchedVerification.charOffset ?? null,
          charEnd: matchedVerification.charOffset != null
            ? matchedVerification.charOffset + (matchedVerification.matchedText?.length || matchedQuote.text?.length || 0)
            : null,
          verificationStatus: matchedVerification.status
        },
        matchReasoning: result.reasoning
      }
    } catch (err) {
      logger.warn(`Extraction failed for ref ${candidateRef.reference_id}:`, err.message)
      refDiag.result = 'error'
      refDiag.error = err.message
      diagnostics.push(refDiag)
      continue
    }
  }

  return null
}

/**
 * Match a single claim to references using V2 pipeline.
 *
 * Pipeline:
 * Tier 0.5: Fact-anchored search (fast, high-precision)
 * Tier 1: Semantic retrieval → narrow to top references
 * Tier 2: Full-reference extraction via Gemini Flash
 * Tier 2b: Quote verification against actual text
 *
 * Falls back to keyword matching if the backend search fails.
 * Falls back to direct semantic match if extraction cannot verify a quote.
 */
async function matchSingleClaim(claim, brandId, allReferences, options = {}) {
  const {
    topK = DEFAULT_TOP_K,
    candidatePool = DEFAULT_CANDIDATE_POOL,
    telemetry,
    onStage,
    getFallbackReferencesWithText
  } = options

  const claimStartedAt = Date.now()
  const diagnostics = []

  try {
    // Tier 0.5: Fact-anchored search
    onStage?.('facts')
    const factMatch = await factAnchoredSearch(claim, brandId, telemetry)
    diagnostics.push({
      tier: '0.5-facts',
      result: factMatch ? 'matched' : 'no-match',
      similarity: factMatch?._diag?.similarity ?? null,
      keywordOverlap: factMatch?._diag?.keywordMatches ?? null,
      numericOverlap: factMatch?._diag?.numericMatches ?? null
    })
    if (factMatch) {
      delete factMatch._diag
      return { ...claim, ...factMatch, diagnostics }
    }

    // Tier 1: Semantic retrieval → narrow to top references
    let searchResults = []
    try {
      telemetry.semantic_search_count++
      onStage?.('retrieve')
      const retrievalTopK = Math.max(topK, candidatePool)
      const response = await api.searchPassages(brandId, claim.text, retrievalTopK, { candidatePool })
      searchResults = (response.results || []).slice(0, candidatePool)
    } catch (err) {
      telemetry.keyword_fallback_count++
      onStage?.('fallback')
      logger.warn(`Semantic search failed for claim ${claim.id}, falling back to keyword matching:`, err.message)
      diagnostics.push({ tier: '1-semantic', result: 'error', error: err.message })
      const fallbackResult = await keywordFallbackMatch(claim, getFallbackReferencesWithText, telemetry)
      return { ...fallbackResult, diagnostics }
    }

    if (searchResults.length === 0) {
      diagnostics.push({ tier: '1-semantic', result: 'no-passages', passageCount: 0 })
      return {
        ...claim,
        matched: false,
        reference: null,
        matchReasoning: 'No similar passages found in reference library',
        diagnostics
      }
    }

    // Hybrid rerank
    const rerankedResults = MATCHING_HYBRID_ENABLED
      ? rerankSemanticResults(claim.text, searchResults)
      : enrichSemanticOnlyResults(searchResults)

    // Group by reference — pick top N
    const candidateRefs = groupByReference(rerankedResults, TIER2_MAX_REFERENCES)

    diagnostics.push({
      tier: '1-semantic',
      result: candidateRefs.length > 0 ? 'narrowed' : 'no-candidates',
      passageCount: searchResults.length,
      topPassageScores: rerankedResults.slice(0, 5).map(r => ({
        refName: r.display_alias,
        semantic: Number(r.semantic_score?.toFixed(3)),
        hybrid: Number(r.hybrid_score?.toFixed(3))
      })),
      candidateRefCount: candidateRefs.length,
      candidateRefs: candidateRefs.map(r => ({
        refName: r.display_alias,
        bestHybrid: Number(r.bestHybridScore?.toFixed(3)),
        bestSemantic: Number(r.bestSemanticScore?.toFixed(3))
      }))
    })

    if (candidateRefs.length === 0) {
      return {
        ...claim,
        matched: false,
        reference: null,
        matchReasoning: 'No candidate references found above threshold',
        diagnostics
      }
    }

    // Tier 2 + 2b: Full-reference extraction with quote verification
    onStage?.('extract')
    const extractionMatch = await fullReferenceExtraction(claim, candidateRefs, allReferences, telemetry, diagnostics)
    if (extractionMatch) {
      return { ...claim, ...extractionMatch, diagnostics }
    }

    const topCandidate = rerankedResults[0]
    const leadMargin = topCandidate
      ? (topCandidate.hybrid_score || 0) - (rerankedResults[1]?.hybrid_score || 0)
      : 0
    const semanticFallbackMatch = buildSemanticDirectFallbackMatch(allReferences, topCandidate, leadMargin)
    if (semanticFallbackMatch) {
      telemetry.semantic_direct_fallback_count = (telemetry.semantic_direct_fallback_count || 0) + 1
      diagnostics.push({
        tier: 'final',
        result: 'semantic-direct-fallback',
        refName: topCandidate?.display_alias || null,
        semantic: Number(topCandidate?.semantic_score?.toFixed(3)),
        hybrid: Number(topCandidate?.hybrid_score?.toFixed(3)),
        leadMargin: Number(leadMargin.toFixed(3))
      })
      return { ...claim, ...semanticFallbackMatch, diagnostics }
    }

    diagnostics.push({ tier: 'final', result: 'no-match', lastTier: 'extraction' })
    return {
      ...claim,
      matched: false,
      reference: null,
      matchReasoning: 'No verified supporting quote found in top candidate references',
      diagnostics
    }
  } finally {
    telemetry.per_claim_durations_ms.push(Date.now() - claimStartedAt)
  }
}

/**
 * Fallback: keyword-based matching for when embeddings aren't available.
 * Simplified version of the old Tier 1 + Tier 2 pipeline.
 */
function extractKeywords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word))
    .filter((word, i, arr) => arr.indexOf(word) === i)
}

async function keywordFallbackMatch(claim, allReferences, telemetry = null) {
  const refsForKeywordMatch = typeof allReferences === 'function'
    ? await allReferences()
    : allReferences

  if (!refsForKeywordMatch || refsForKeywordMatch.length === 0) {
    return {
      ...claim,
      matched: false,
      reference: null,
      matchReasoning: 'No reference texts available for keyword fallback'
    }
  }

  const claimKeywords = extractKeywords(claim.text)

  const scored = refsForKeywordMatch
    .map(ref => {
      if (!ref.content_text || claimKeywords.length === 0) return { ...ref, score: 0 }
      const refLower = ref.content_text.toLowerCase()
      const matches = claimKeywords.filter(kw => refLower.includes(kw))
      return { ...ref, score: matches.length / claimKeywords.length }
    })
    .filter(ref => ref.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  if (scored.length === 0) {
    return {
      ...claim,
      matched: false,
      reference: null,
      matchReasoning: 'No keyword overlap with any reference (fallback mode)'
    }
  }

  const refsForAI = scored.map(ref => ({
    name: ref.display_alias,
    excerpt: ref.content_text?.slice(0, 3000) || ''
  }))

  try {
    const matchResponse = await matchClaimToReferences(claim.text, refsForAI)
    accumulateMatchingUsage(telemetry, matchResponse?.usage)
    let result = matchResponse?.result
    if (Array.isArray(result)) {
      result = result.find(r => r.matched) || result[0] || { matched: false }
    }
    if (!result || typeof result !== 'object') {
      result = { matched: false }
    }

    const matched = selectAICandidate(result, scored)
    if (result.matched && matched) {
      return {
        ...claim,
        matched: true,
        matchConfidence: resolveMatchConfidence(result.confidence, matched.score),
        matchTier: 'keyword-fallback',
        reference: {
          id: matched.id,
          name: result.referenceName || matched.display_alias,
          page: result.pageInReference,
          excerpt: result.supportingExcerpt || matched.content_text?.slice(0, 300),
          charStart: null,
          charEnd: null,
          verificationStatus: 'keyword-fallback'
        },
        matchReasoning: result.reasoning + ' (keyword fallback)'
      }
    }

    if (result.matched && !matched) {
      logger.warn(`Keyword fallback AI matched claim ${claim.id} without resolvable candidate`, {
        referenceIndex: result.referenceIndex,
        referenceName: result.referenceName
      })
    }
    return { ...claim, matched: false, reference: null, matchReasoning: result.reasoning || 'No match found (fallback)' }
  } catch (error) {
    return { ...claim, matched: false, reference: null, matchReasoning: `Fallback error: ${error.message}` }
  }
}

/**
 * Match all claims to references using V2 pipeline.
 * Processes every claim individually — no dedup (MLR requires each instance annotated).
 *
 * @param {Array} claims - Array of detected claims
 * @param {Array} references - Array of reference objects with { id, display_alias }
 * @param {Function} onProgress - Progress callback ({ current, total, claim, claimIndex, stage })
 *   stage: facts | retrieve | extract | fallback | done
 * @param {number} brandId - Brand ID for semantic search
 * @param {Object} options - Optional matcher settings
 * @returns {Promise<Object>} - { claims, telemetry }
 */
export async function matchAllClaimsToReferences(claims, references, onProgress, brandId, options = {}) {
  const CONCURRENCY = resolveConcurrency(options.concurrency, DEFAULT_MATCHING_CONCURRENCY)
  const topK = options.topK || DEFAULT_TOP_K
  const candidatePool = Math.max(topK, options.candidatePool || DEFAULT_CANDIDATE_POOL)
  const onClaimResult = typeof options.onClaimResult === 'function'
    ? options.onClaimResult
    : null
  let completed = 0
  const results = new Array(claims.length)
  const startedAt = Date.now()

  const telemetry = {
    total_claims: claims.length,
    matching_total_ms: 0,
    reference_fetch_ms: 0,
    per_claim_durations_ms: [],
    per_claim_match_ms: { count: 0, min: 0, avg: 0, p95: 0, max: 0 },
    semantic_search_count: 0,
    fact_anchored_count: 0,
    extraction_ai_calls: 0,
    verified_quotes: 0,
    unverified_quotes: 0,
    semantic_direct_fallback_count: 0,
    keyword_fallback_count: 0,
    matching_ai_calls: 0,
    matching_ai_input_tokens: 0,
    matching_ai_output_tokens: 0,
    matching_ai_cost: 0,
    concurrency: CONCURRENCY,
    top_k: topK,
    candidate_pool: candidatePool,
    hybrid_enabled: MATCHING_HYBRID_ENABLED,
    tier2_max_references: TIER2_MAX_REFERENCES,
    semantic_direct_fallback_enabled: MATCHING_SEMANTIC_DIRECT_FALLBACK_ENABLED
  }

  const getFallbackReferencesWithText = createFallbackReferenceLoader(references, telemetry)

  // Process all claims individually — no dedup (MLR requires each instance annotated)
  for (let start = 0; start < claims.length; start += CONCURRENCY) {
    const batch = []
    for (let i = start; i < Math.min(start + CONCURRENCY, claims.length); i++) {
      batch.push(i)
    }

    const batchPromises = batch.map((claimIndex) => {
      const claim = claims[claimIndex]

      return matchSingleClaim(claim, brandId, references, {
        topK,
        candidatePool,
        telemetry,
        getFallbackReferencesWithText,
        onStage: (stage) => {
          onProgress?.({
            current: completed,
            total: claims.length,
            claim,
            claimIndex: claimIndex + 1,
            stage
          })
        }
      }).then((matchResult) => {
        const normalizedMatchResult = applyMatchConfidenceToClaim(matchResult)
        results[claimIndex] = normalizedMatchResult
        completed += 1
        const progressPayload = {
          current: completed,
          total: claims.length,
          claim,
          claimIndex: claimIndex + 1,
          stage: 'done'
        }
        onProgress?.(progressPayload)
        onClaimResult?.({ ...progressPayload, claim: normalizedMatchResult })
      }).catch((error) => {
        logger.error(`Claim matching failed for claim ${claim.id}:`, error)
        results[claimIndex] = {
          ...claim,
          matched: false,
          reference: null,
          matchReasoning: `Matching error: ${error.message}`
        }
        completed += 1
        const progressPayload = {
          current: completed,
          total: claims.length,
          claim,
          claimIndex: claimIndex + 1,
          stage: 'done'
        }
        onProgress?.(progressPayload)
        onClaimResult?.({ ...progressPayload, claim: results[claimIndex] })
        telemetry.failed_claim_count = (telemetry.failed_claim_count || 0) + 1
      })
    })
    await Promise.all(batchPromises)
  }

  telemetry.matching_total_ms = Date.now() - startedAt
  telemetry.per_claim_match_ms = summarizeDurations(telemetry.per_claim_durations_ms)
  delete telemetry.per_claim_durations_ms

  // Pipeline summary: count outcomes by tier from diagnostics
  const pipelineSummary = {
    fact_anchored_matched: 0,
    semantic_no_passages: 0,
    semantic_direct_fallback_matched: 0,
    keyword_fallback_matched: 0,
    extraction_matched: 0,
    extraction_not_supported: 0,
    extraction_unverified: 0,
    no_match: 0,
    errors: 0
  }
  for (const claim of results) {
    if (!claim?.diagnostics) { pipelineSummary.errors++; continue }

    if (claim.matchTier === 'fact-anchored') pipelineSummary.fact_anchored_matched++
    else if (claim.matchTier === 'verified-extraction' || claim.matchTier === 'partial-extraction') pipelineSummary.extraction_matched++
    else if (claim.matchTier === 'semantic-direct-fallback') pipelineSummary.semantic_direct_fallback_matched++
    else if (claim.matchTier === 'keyword-fallback') pipelineSummary.keyword_fallback_matched++
    else if (!claim.matched) {
      // Determine why it didn't match from diagnostics
      const semanticDiag = claim.diagnostics.find(d => d.tier === '1-semantic')
      if (semanticDiag?.result === 'no-passages') { pipelineSummary.semantic_no_passages++; continue }
      if (semanticDiag?.result === 'error') { pipelineSummary.errors++; continue }

      const extractionDiags = claim.diagnostics.filter(d => d.tier === '2-extraction')
      const hasUnverified = extractionDiags.some(d => d.result === 'unverified')
      const hasNotSupported = extractionDiags.some(d => d.result === 'not-supported')
      if (hasUnverified) pipelineSummary.extraction_unverified++
      else if (hasNotSupported) pipelineSummary.extraction_not_supported++
      else pipelineSummary.no_match++
    }
  }
  telemetry.pipeline_summary = pipelineSummary

  return { claims: results, telemetry }
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

  // Count by match tier
  const tiers = {}
  enrichedClaims.filter(c => c.matched && c.matchTier).forEach(c => {
    tiers[c.matchTier] = (tiers[c.matchTier] || 0) + 1
  })

  return {
    total,
    matched,
    unmatched,
    matchRate: total > 0 ? (matched / total * 100).toFixed(1) : '0.0',
    avgConfidence: (avgConfidence * 100).toFixed(1),
    tiers
  }
}
