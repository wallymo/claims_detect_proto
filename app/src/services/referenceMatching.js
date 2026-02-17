import { matchClaimToReferences } from './gemini.js'
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
const MATCHING_AUTOCONFIRM_ENABLED = parseBooleanEnvFlag(viteEnv.VITE_MATCHING_AUTOCONFIRM_ENABLED, false)
const MATCHING_SKIP_CONFIRM_LOW_CONFIDENCE_ENABLED = parseBooleanEnvFlag(
  viteEnv.VITE_MATCHING_SKIP_CONFIRM_LOW_CONFIDENCE_ENABLED,
  false
)

const DEFAULT_TOP_K = parsePositiveIntEnv(viteEnv.VITE_MATCHING_TOPK, 20)
const DEFAULT_CANDIDATE_POOL = parsePositiveIntEnv(viteEnv.VITE_MATCHING_CANDIDATE_POOL, 40)
const DEFAULT_AI_CONFIRMATION_CANDIDATES = parsePositiveIntEnv(viteEnv.VITE_MATCHING_CONFIRM_TOPN, 8)
const MATCHING_CONFIRM_DIVERSITY_ENABLED = parseBooleanEnvFlag(viteEnv.VITE_MATCHING_CONFIRM_DIVERSITY_ENABLED, true)
const DEFAULT_AI_CONFIRM_PER_REFERENCE_CAP = parsePositiveIntEnv(viteEnv.VITE_MATCHING_CONFIRM_PER_REFERENCE_CAP, 2)
const DEFAULT_MATCHING_CONCURRENCY = parsePositiveIntEnv(viteEnv.VITE_MATCHING_CONCURRENCY, 4)

const HYBRID_WEIGHTS = {
  semantic: 0.75,
  keyword: 0.15,
  numeric: 0.10
}

const AUTO_CONFIRM_MIN_SEMANTIC = 0.92
const AUTO_CONFIRM_MIN_HYBRID = 0.76
const AUTO_CONFIRM_MIN_MARGIN = 0.10
const AUTO_CONFIRM_MIN_KEYWORD = 0.10

const SKIP_CONFIRM_MAX_SEMANTIC = parseBoundedFloatEnv(
  viteEnv.VITE_MATCHING_SKIP_CONFIRM_MAX_SEMANTIC,
  0.50
)
const SKIP_CONFIRM_MAX_HYBRID = parseBoundedFloatEnv(
  viteEnv.VITE_MATCHING_SKIP_CONFIRM_MAX_HYBRID,
  0.46
)
const SKIP_CONFIRM_MAX_KEYWORD = parseBoundedFloatEnv(
  viteEnv.VITE_MATCHING_SKIP_CONFIRM_MAX_KEYWORD,
  0.08
)

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

/**
 * Truncate text to a reasonable excerpt length for the AI prompt.
 * Takes first ~3000 chars — enough for ~750 words of context per passage.
 */
function truncateForPrompt(text, maxChars = 3000) {
  if (!text || text.length <= maxChars) return text
  return text.slice(0, maxChars) + '...'
}

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

function normalizeClaimDedupKey(text) {
  if (!text) return ''
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeAlias(text) {
  if (!text) return ''
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
  if (Number.isFinite(direct) && direct >= 1 && direct <= maxCandidates) {
    return direct
  }

  const extracted = asText.match(/\d+/)
  if (extracted) {
    const parsed = Number.parseInt(extracted[0], 10)
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= maxCandidates) {
      return parsed
    }
  }

  return null
}

function candidateSelectionKey(candidate, fallbackIndex = 0) {
  if (!candidate) return `candidate:${fallbackIndex}`

  if (candidate.passage_id !== undefined && candidate.passage_id !== null) {
    return `passage:${candidate.passage_id}`
  }

  if (candidate.id !== undefined && candidate.id !== null) {
    return `id:${candidate.id}`
  }

  const refId = candidate.reference_id ?? candidate.display_alias ?? 'unknown'
  const page = candidate.page_estimate ?? candidate.page ?? 'na'
  const textSnippet = String(candidate.passage_text || candidate.excerpt || candidate.content_text || '')
    .slice(0, 80)
  return `fallback:${refId}:${page}:${textSnippet}:${fallbackIndex}`
}

function selectConfirmationCandidates(candidates, maxCandidates, perReferenceCap, diversityEnabled = true) {
  const source = Array.isArray(candidates) ? candidates : []
  if (!diversityEnabled || source.length <= 1 || perReferenceCap < 1) {
    return source.slice(0, maxCandidates)
  }

  const selected = []
  const selectedKeys = new Set()
  const perRefCounts = new Map()

  source.forEach((candidate, index) => {
    if (selected.length >= maxCandidates) return

    const key = candidateSelectionKey(candidate, index)
    if (selectedKeys.has(key)) return

    const refKey = candidate.reference_id ?? candidate.display_alias ?? `unknown-${index}`
    const refCount = perRefCounts.get(refKey) || 0
    if (refCount >= perReferenceCap) return

    selected.push(candidate)
    selectedKeys.add(key)
    perRefCounts.set(refKey, refCount + 1)
  })

  if (selected.length < maxCandidates) {
    source.forEach((candidate, index) => {
      if (selected.length >= maxCandidates) return
      const key = candidateSelectionKey(candidate, index)
      if (selectedKeys.has(key)) return
      selected.push(candidate)
      selectedKeys.add(key)
    })
  }

  return selected
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

function selectAICandidate(result, candidates) {
  if (!result?.matched || !Array.isArray(candidates) || candidates.length === 0) {
    return null
  }

  if (candidates.length === 1) {
    return candidates[0]
  }

  const index = parseReferenceIndex(result.referenceIndex, candidates.length)
  if (index) {
    return candidates[index - 1]
  }

  const resultName = normalizeAlias(result.referenceName)
  if (resultName) {
    const exactNameMatch = candidates.find(candidate => {
      const candidateName = normalizeAlias(candidate.display_alias || candidate.name)
      return candidateName === resultName
    })
    if (exactNameMatch) return exactNameMatch

    const fuzzyNameMatch = candidates.find(candidate => {
      const candidateName = normalizeAlias(candidate.display_alias || candidate.name)
      return candidateName.includes(resultName) || resultName.includes(candidateName)
    })
    if (fuzzyNameMatch) return fuzzyNameMatch
  }

  const excerpt = normalizeAlias(result.supportingExcerpt)
  if (excerpt.length >= 20) {
    const excerptNeedle = excerpt.slice(0, 180)
    const excerptMatch = candidates.find(candidate => {
      const candidateText = normalizeAlias(candidate.passage_text || candidate.content_text || candidate.excerpt)
      return candidateText.includes(excerptNeedle)
    })
    if (excerptMatch) return excerptMatch
  }

  return null
}

function buildClaimGroups(claims) {
  const groupsByKey = new Map()

  claims.forEach((claim, index) => {
    const key = normalizeClaimDedupKey(claim.text) || `claim-${index}`
    const existing = groupsByKey.get(key)
    if (existing) {
      existing.indices.push(index)
      return
    }
    groupsByKey.set(key, {
      key,
      primaryIndex: index,
      indices: [index]
    })
  })

  return Array.from(groupsByKey.values())
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

function evaluateAutoConfirm(candidates) {
  if (!candidates.length) {
    return {
      shouldAutoConfirm: false,
      topCandidate: null,
      leadMargin: 0
    }
  }

  const topCandidate = candidates[0]
  const secondCandidate = candidates[1]
  const leadMargin = topCandidate.hybrid_score - (secondCandidate?.hybrid_score || 0)

  const shouldAutoConfirm = (
    topCandidate.semantic_score >= AUTO_CONFIRM_MIN_SEMANTIC &&
    topCandidate.hybrid_score >= AUTO_CONFIRM_MIN_HYBRID &&
    topCandidate.keyword_overlap >= AUTO_CONFIRM_MIN_KEYWORD &&
    leadMargin >= AUTO_CONFIRM_MIN_MARGIN
  )

  return {
    shouldAutoConfirm,
    topCandidate,
    leadMargin
  }
}

function evaluateSkipConfirmation(candidates) {
  if (!candidates.length) {
    return {
      shouldSkip: false,
      topCandidate: null
    }
  }

  const topCandidate = candidates[0]
  const semantic = topCandidate.semantic_score ?? 0
  const hybrid = topCandidate.hybrid_score ?? 0
  const keyword = topCandidate.keyword_overlap ?? 0

  const shouldSkip = (
    semantic <= SKIP_CONFIRM_MAX_SEMANTIC &&
    hybrid <= SKIP_CONFIRM_MAX_HYBRID &&
    keyword <= SKIP_CONFIRM_MAX_KEYWORD
  )

  return { shouldSkip, topCandidate }
}

function copyMatchToDuplicateClaim(targetClaim, sourceClaimResult) {
  return {
    ...targetClaim,
    matched: sourceClaimResult.matched,
    matchConfidence: sourceClaimResult.matchConfidence,
    matchTier: sourceClaimResult.matchTier,
    reference: sourceClaimResult.reference ? { ...sourceClaimResult.reference } : null,
    matchReasoning: sourceClaimResult.matchReasoning
  }
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

/**
 * Match a single claim to references using semantic search.
 *
 * Pipeline:
 * 1. Call backend to embed claim and retrieve top-K passages
 * 2. Hybrid-rerank candidates by semantic + keyword + numeric overlap
 * 3. Auto-confirm high-confidence matches; use Gemini only for ambiguous cases
 * 4. Return match result
 *
 * Falls back to the old keyword matching if the backend search fails
 * (e.g., if embeddings haven't been generated yet).
 */
async function matchSingleClaim(claim, brandId, allReferences, options = {}) {
  const {
    topK = DEFAULT_TOP_K,
    candidatePool = DEFAULT_CANDIDATE_POOL,
    aiConfirmationCandidates = DEFAULT_AI_CONFIRMATION_CANDIDATES,
    aiConfirmPerReferenceCap = DEFAULT_AI_CONFIRM_PER_REFERENCE_CAP,
    telemetry,
    onStage,
    getFallbackReferencesWithText
  } = options

  const claimStartedAt = Date.now()

  try {
  // Step 1: Semantic search via backend
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
      return keywordFallbackMatch(claim, getFallbackReferencesWithText, telemetry)
    }

    if (searchResults.length === 0) {
      return {
        ...claim,
        matched: false,
        reference: null,
        matchReasoning: 'No similar passages found in reference library'
      }
    }

    // Step 2: Hybrid rerank + confidence gating
    const rerankedResults = MATCHING_HYBRID_ENABLED
      ? rerankSemanticResults(claim.text, searchResults)
      : enrichSemanticOnlyResults(searchResults)
    const { shouldAutoConfirm, topCandidate, leadMargin } = evaluateAutoConfirm(rerankedResults)
    const { shouldSkip: shouldSkipConfirmation, topCandidate: lowConfidenceTop } = evaluateSkipConfirmation(rerankedResults)

    if (MATCHING_AUTOCONFIRM_ENABLED && shouldAutoConfirm && topCandidate) {
      telemetry.autoconfirm_count++
      return {
        ...claim,
        matched: true,
        matchConfidence: topCandidate.hybrid_score,
        matchTier: 'hybrid-autoconfirm',
        reference: {
          id: topCandidate.reference_id,
          name: topCandidate.display_alias,
          page: topCandidate.page_estimate,
          excerpt: topCandidate.passage_text?.slice(0, 400)
        },
        matchReasoning: `Auto-confirmed by hybrid score (${(topCandidate.hybrid_score * 100).toFixed(0)}%), semantic ${(topCandidate.semantic_score * 100).toFixed(0)}%, lead +${(leadMargin * 100).toFixed(0)}`
      }
    }

    if (MATCHING_SKIP_CONFIRM_LOW_CONFIDENCE_ENABLED && shouldSkipConfirmation && lowConfidenceTop) {
      telemetry.confirmation_skipped_low_confidence_count++
      return {
        ...claim,
        matched: false,
        reference: null,
        matchReasoning: `Skipped AI confirmation: low retrieval confidence (hybrid ${(lowConfidenceTop.hybrid_score * 100).toFixed(0)}%, semantic ${(lowConfidenceTop.semantic_score * 100).toFixed(0)}%)`
      }
    }

    // Step 3: AI confirmation for ambiguous cases only
    const baselineCandidates = rerankedResults.slice(0, aiConfirmationCandidates)
    const preDiversityCount = baselineCandidates.length
    const aiCandidates = selectConfirmationCandidates(
      rerankedResults,
      aiConfirmationCandidates,
      aiConfirmPerReferenceCap,
      MATCHING_CONFIRM_DIVERSITY_ENABLED
    )
    telemetry.ai_candidates_total += aiCandidates.length
    telemetry.ai_candidates_pre_diversity_total += preDiversityCount
    telemetry.ai_diversity_pruned_total += Math.max(0, preDiversityCount - aiCandidates.length)
    const baselineKeys = new Set(baselineCandidates.map((candidate, index) => candidateSelectionKey(candidate, index)))
    const replacementCount = aiCandidates.reduce((count, candidate, index) => (
      baselineKeys.has(candidateSelectionKey(candidate, index)) ? count : count + 1
    ), 0)
    telemetry.ai_diversity_replacements_total += replacementCount

    const refsForAI = aiCandidates.map((result) => ({
      name: result.display_alias,
      excerpt: truncateForPrompt(result.passage_text),
      page: result.page_estimate,
      similarity: result.semantic_score,
      hybridScore: result.hybrid_score,
      keywordOverlap: result.keyword_overlap,
      numericOverlap: result.numeric_overlap
    }))

    try {
      telemetry.confirmation_count++
      onStage?.('confirm')
      const matchResponse = await matchClaimToReferences(claim.text, refsForAI)
      accumulateMatchingUsage(telemetry, matchResponse?.usage)
      let result = matchResponse?.result

      // AI sometimes returns an array of matches — normalize to single best match
      if (Array.isArray(result)) {
        result = result.find(r => r.matched) || result[0] || { matched: false }
      }
      if (!result || typeof result !== 'object') {
        result = { matched: false }
      }

      const matchedResult = selectAICandidate(result, aiCandidates)
      if (result.matched && matchedResult) {
        // Look up the full reference object to get the ID
        const refObj = allReferences.find(r =>
          normalizeAlias(r.display_alias) === normalizeAlias(matchedResult.display_alias) ||
          r.id === matchedResult.reference_id
        )

        return {
          ...claim,
          matched: true,
          matchConfidence: resolveMatchConfidence(result.confidence, matchedResult.hybrid_score),
          matchTier: 'hybrid-semantic',
          reference: {
            id: refObj?.id || matchedResult.reference_id,
            name: result.referenceName || matchedResult.display_alias,
            page: result.pageInReference || matchedResult.page_estimate,
            excerpt: result.supportingExcerpt || matchedResult.passage_text?.slice(0, 400)
          },
          matchReasoning: result.reasoning
        }
      }

      if (result.matched && !matchedResult) {
        logger.warn(`AI confirmed claim ${claim.id} but did not return a resolvable reference identifier`, {
          referenceIndex: result.referenceIndex,
          referenceName: result.referenceName
        })
      }

      return {
        ...claim,
        matched: false,
        reference: null,
        matchReasoning: result.reasoning || 'AI could not confirm a supporting reference'
      }
    } catch (error) {
      logger.error(`AI confirmation error for claim ${claim.id}:`, error)
      // If AI fails, use the top semantic result directly if similarity is high enough
      const top = rerankedResults[0]
      if (top && (top.semantic_score >= 0.85 || top.hybrid_score >= 0.78)) {
        const refObj = allReferences.find(r => r.id === top.reference_id)
        return {
          ...claim,
          matched: true,
          matchConfidence: top.hybrid_score,
          matchTier: 'hybrid-direct',
          reference: {
            id: refObj?.id || top.reference_id,
            name: top.display_alias,
            page: top.page_estimate,
            excerpt: top.passage_text?.slice(0, 300)
          },
          matchReasoning: `High-confidence fallback match (hybrid ${(top.hybrid_score * 100).toFixed(0)}%, semantic ${(top.semantic_score * 100).toFixed(0)}%)`
        }
      }
      return {
        ...claim,
        matched: false,
        reference: null,
        matchReasoning: `Matching error: ${error.message}`
      }
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
          excerpt: result.supportingExcerpt || matched.content_text?.slice(0, 300)
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
 * Match all claims to references using semantic search.
 * Processes claims in batches to manage API rate limits.
 *
 * @param {Array} claims - Array of detected claims
 * @param {Array} references - Array of reference objects with { id, display_alias }
 * @param {Function} onProgress - Progress callback ({ current, total, claim, claimIndex, stage })
 *   stage: retrieve | confirm | fallback | dedup | done
 * @param {number} brandId - Brand ID for semantic search
 * @param {Object} options - Optional matcher settings
 * @returns {Promise<Object>} - { claims, telemetry }
 */
export async function matchAllClaimsToReferences(claims, references, onProgress, brandId, options = {}) {
  const CONCURRENCY = resolveConcurrency(options.concurrency, DEFAULT_MATCHING_CONCURRENCY)
  const topK = options.topK || DEFAULT_TOP_K
  const candidatePool = Math.max(topK, options.candidatePool || DEFAULT_CANDIDATE_POOL)
  const retrievalTopK = Math.max(topK, candidatePool)
  const aiConfirmationCandidates = options.aiConfirmationCandidates || DEFAULT_AI_CONFIRMATION_CANDIDATES
  const aiConfirmPerReferenceCap = options.aiConfirmPerReferenceCap || DEFAULT_AI_CONFIRM_PER_REFERENCE_CAP
  const onClaimResult = typeof options.onClaimResult === 'function'
    ? options.onClaimResult
    : null
  let completed = 0
  const results = new Array(claims.length)
  const startedAt = Date.now()
  const claimGroups = buildClaimGroups(claims)

  const telemetry = {
    total_claims: claims.length,
    unique_claims: claimGroups.length,
    duplicate_claims: claims.length - claimGroups.length,
    dedup_fanout_count: claims.length - claimGroups.length,
    matching_total_ms: 0,
    reference_fetch_ms: 0,
    per_claim_durations_ms: [],
    per_claim_match_ms: {
      count: 0,
      min: 0,
      avg: 0,
      p95: 0,
      max: 0
    },
    semantic_search_count: 0,
    confirmation_count: 0,
    autoconfirm_count: 0,
    ai_candidates_total: 0,
    ai_candidates_pre_diversity_total: 0,
    ai_diversity_pruned_total: 0,
    ai_diversity_replacements_total: 0,
    keyword_fallback_count: 0,
    matching_ai_calls: 0,
    matching_ai_input_tokens: 0,
    matching_ai_output_tokens: 0,
    matching_ai_cost: 0,
    confirmation_skipped_low_confidence_count: 0,
    concurrency: CONCURRENCY,
    top_k: topK,
    retrieval_top_k: retrievalTopK,
    candidate_pool: candidatePool,
    ai_confirmation_candidates: aiConfirmationCandidates,
    ai_confirm_per_reference_cap: aiConfirmPerReferenceCap,
    hybrid_enabled: MATCHING_HYBRID_ENABLED,
    autoconfirm_enabled: MATCHING_AUTOCONFIRM_ENABLED,
    skip_confirm_low_confidence_enabled: MATCHING_SKIP_CONFIRM_LOW_CONFIDENCE_ENABLED,
    skip_confirm_max_semantic: SKIP_CONFIRM_MAX_SEMANTIC,
    skip_confirm_max_hybrid: SKIP_CONFIRM_MAX_HYBRID,
    skip_confirm_max_keyword: SKIP_CONFIRM_MAX_KEYWORD,
    confirm_diversity_enabled: MATCHING_CONFIRM_DIVERSITY_ENABLED
  }

  const getFallbackReferencesWithText = createFallbackReferenceLoader(references, telemetry)

  for (let start = 0; start < claimGroups.length; start += CONCURRENCY) {
    const batch = claimGroups.slice(start, start + CONCURRENCY)
    const batchPromises = batch.map((group) => {
      const primaryIndex = group.primaryIndex
      const primaryClaim = claims[primaryIndex]

      return matchSingleClaim(primaryClaim, brandId, references, {
        topK,
        candidatePool,
        aiConfirmationCandidates,
        aiConfirmPerReferenceCap,
        telemetry,
        getFallbackReferencesWithText,
        onStage: (stage) => {
          onProgress?.({
            current: completed,
            total: claims.length,
            claim: primaryClaim,
            claimIndex: primaryIndex + 1,
            stage
          })
        }
      }).then((primaryResult) => {
        for (const claimIndex of group.indices) {
          const claim = claims[claimIndex]
          const isPrimary = claimIndex === primaryIndex
          results[claimIndex] = isPrimary
            ? primaryResult
            : copyMatchToDuplicateClaim(claim, primaryResult)

          completed += 1
          const stage = isPrimary ? 'done' : 'dedup'
          const progressPayload = {
            current: completed,
            total: claims.length,
            claim,
            claimIndex: claimIndex + 1,
            stage
          }
          onProgress?.(progressPayload)
          onClaimResult?.({
            ...progressPayload,
            claim: results[claimIndex]
          })
        }
      }).catch((error) => {
        logger.error(`Claim matching failed for claim ${primaryClaim.id}:`, error)
        for (const claimIndex of group.indices) {
          const claim = claims[claimIndex]
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
          onClaimResult?.({
            ...progressPayload,
            claim: results[claimIndex]
          })
        }
        telemetry.failed_claim_count = (telemetry.failed_claim_count || 0) + group.indices.length
      })
    })
    await Promise.all(batchPromises)
  }

  telemetry.matching_total_ms = Date.now() - startedAt
  telemetry.per_claim_match_ms = summarizeDurations(telemetry.per_claim_durations_ms)
  telemetry.confirmation_skipped_count = Math.max(0, telemetry.unique_claims - telemetry.confirmation_count)
  delete telemetry.per_claim_durations_ms

  return {
    claims: results,
    telemetry
  }
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
