/**
 * Claim deduplication helpers
 *
 * Dedupe policy:
 * - Duplicate if SAME page/slide + same normalized text
 * - Keep cross-page/slide repeats (same sentence on different pages/slides)
 * - Never dedupe globally across the whole document
 */

const SUPERSCRIPT_MARKERS_RE = /[\u00B9\u00B2\u00B3\u2070-\u2079]+/g
const CITATION_SYMBOLS_RE = /[†‡§]+/g
const WRAPPING_QUOTES_RE = /["'`“”‘’]/g
const TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/g
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g
const DASH_VARIANTS_RE = /[‐‑–—−]/g
const PERCENT_RE = /\b\d+(?:\.\d+)?%/g
const P_VALUE_RE = /\bp\s*[<=>]\s*0?\.\d+\b/gi
const SAMPLE_SIZE_RE = /\bn\s*[=:]?\s*\d+\b/gi
const ALL_NUMBERS_RE = /\b\d+(?:\.\d+)?\b/g

const QUALIFIER_PATTERNS = [
  { re: /\bp\s*[<=>]\s*0?\.\d+\b/i, weight: 3 },
  { re: /\b(?:95|90|99)%\s*ci\b/i, weight: 2 },
  { re: /\bconfidence interval\b/i, weight: 2 },
  { re: /\bhazard ratio\b/i, weight: 2 },
  { re: /\bodds ratio\b/i, weight: 2 },
  { re: /\brisk ratio\b/i, weight: 2 },
  { re: /\brelative risk\b/i, weight: 2 },
  { re: /\bn\s*[=:]?\s*\d+\b/i, weight: 1.5 },
  { re: /\b(?:mean|median|standard deviation|std\.?|se)\b/i, weight: 1 },
  { re: /\bvs\.?\b|\bversus\b|\bcompared with\b/i, weight: 1 }
]

function parseBooleanEnvFlag(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function parseFloatEnv(value, fallback, min = 0, max = 1) {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

const viteEnv = typeof import.meta !== 'undefined' && import.meta.env
  ? import.meta.env
  : {}

export const CLAIM_NEAR_DEDUP_ENABLED = parseBooleanEnvFlag(
  viteEnv.VITE_CLAIM_NEAR_DEDUP_ENABLED,
  true
)

export const CLAIM_DEDUP_DEBUG_ENABLED = parseBooleanEnvFlag(
  viteEnv.VITE_CLAIM_DEDUP_DEBUG,
  false
)

const CLAIM_NEAR_DEDUP_SIMILARITY = parseFloatEnv(
  viteEnv.VITE_CLAIM_NEAR_DEDUP_SIMILARITY,
  0.72,
  0.5,
  0.99
)

const CLAIM_NEAR_DEDUP_OVERLAP = parseFloatEnv(
  viteEnv.VITE_CLAIM_NEAR_DEDUP_OVERLAP,
  0.85,
  0.5,
  1
)

const DEFAULT_DEDUP_OPTIONS = {
  strategy: CLAIM_NEAR_DEDUP_ENABLED ? 'aggressive-near' : 'exact',
  nearSimilarity: CLAIM_NEAR_DEDUP_SIMILARITY,
  nearOverlap: CLAIM_NEAR_DEDUP_OVERLAP,
  debug: CLAIM_DEDUP_DEBUG_ENABLED
}

export function getClaimDedupOptions(overrides = {}) {
  return {
    ...DEFAULT_DEDUP_OPTIONS,
    ...overrides
  }
}

export function normalizeDedupText(text) {
  const normalized = String(text || '')
    .normalize('NFKC')
    .replace(ZERO_WIDTH_RE, '')
    .replace(SUPERSCRIPT_MARKERS_RE, '')
    .replace(CITATION_SYMBOLS_RE, '')
    .replace(WRAPPING_QUOTES_RE, '')
    .replace(DASH_VARIANTS_RE, '-')
    .replace(/\bversus\b/gi, 'vs')
    .replace(TRAILING_PUNCTUATION_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  // Canonical token stream: ignore punctuation/symbol jitter while preserving
  // word order and numeric tokens (including percentages).
  const tokens = normalized.match(/[\p{L}\p{N}%]+(?:[.-][\p{L}\p{N}%]+)*/gu) || []
  return tokens.join(' ')
}

function tokenizeDedupText(text) {
  const normalized = normalizeDedupText(text)
  return normalized ? normalized.split(' ').filter(Boolean) : []
}

function normalizeNumberToken(token) {
  return String(token || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim()
}

function toUniqueSet(values) {
  return new Set(values.filter(Boolean))
}

function extractNumericSignature(text) {
  const source = String(text || '').toLowerCase()
  const percentages = toUniqueSet((source.match(PERCENT_RE) || []).map(normalizeNumberToken))
  const pValues = toUniqueSet((source.match(P_VALUE_RE) || []).map(normalizeNumberToken))
  const sampleSizes = toUniqueSet((source.match(SAMPLE_SIZE_RE) || []).map(normalizeNumberToken))
  const allNumbers = toUniqueSet((source.match(ALL_NUMBERS_RE) || []).map(normalizeNumberToken))

  return {
    percentages,
    pValues,
    sampleSizes,
    allNumbers
  }
}

function setsIntersect(a, b) {
  for (const value of a) {
    if (b.has(value)) return true
  }
  return false
}

function hasConflictingNumericEvidence(textA, textB) {
  const a = extractNumericSignature(textA)
  const b = extractNumericSignature(textB)

  if (a.percentages.size > 0 && b.percentages.size > 0 && !setsIntersect(a.percentages, b.percentages)) {
    return true
  }

  if (a.pValues.size > 0 && b.pValues.size > 0 && !setsIntersect(a.pValues, b.pValues)) {
    return true
  }

  if (a.sampleSizes.size > 0 && b.sampleSizes.size > 0 && !setsIntersect(a.sampleSizes, b.sampleSizes)) {
    return true
  }

  if (a.allNumbers.size >= 2 && b.allNumbers.size >= 2 && !setsIntersect(a.allNumbers, b.allNumbers)) {
    return true
  }

  return false
}

function computeSimilarity(textA, textB) {
  const tokensA = tokenizeDedupText(textA)
  const tokensB = tokenizeDedupText(textB)
  if (tokensA.length === 0 || tokensB.length === 0) {
    return {
      overlap: 0,
      jaccard: 0,
      contained: false,
      tokenCountA: tokensA.length,
      tokenCountB: tokensB.length,
      sharedTokens: 0
    }
  }

  const setA = new Set(tokensA)
  const setB = new Set(tokensB)
  let intersection = 0
  for (const token of setA) {
    if (setB.has(token)) intersection += 1
  }

  const union = setA.size + setB.size - intersection
  const overlap = intersection / Math.max(1, Math.min(setA.size, setB.size))
  const jaccard = intersection / Math.max(1, union)

  const normalizedA = tokensA.join(' ')
  const normalizedB = tokensB.join(' ')
  const contained = normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)

  return {
    overlap,
    jaccard,
    contained,
    tokenCountA: setA.size,
    tokenCountB: setB.size,
    sharedTokens: intersection
  }
}

function claimQualifierScore(text) {
  const source = String(text || '')
  let score = 0
  for (const { re, weight } of QUALIFIER_PATTERNS) {
    if (re.test(source)) score += weight
  }
  return score
}

function claimCompletenessScore(claim) {
  const text = String(claim?.text || '').replace(/\s+/g, ' ').trim()
  if (!text) return 0

  const tokenCount = tokenizeDedupText(text).length
  const qualifier = claimQualifierScore(text)
  const hasSentenceTerminator = /[.!?)]$/.test(text) ? 8 : 0
  const hasActionVerb = /\b(is|are|was|were|showed|demonstrated|reduced|increased|improved|decreased)\b/i.test(text)
    ? 6
    : 0

  return (
    Math.min(220, text.length) +
    Math.min(140, tokenCount * 4) +
    qualifier * 20 +
    hasSentenceTerminator +
    hasActionVerb
  )
}

function claimHasPosition(claim) {
  const position = claim?.position
  if (!position || typeof position !== 'object') return false

  const x = Number(position.x)
  const y = Number(position.y)
  return Number.isFinite(x) && Number.isFinite(y)
}

function claimHasNonZeroPosition(claim) {
  if (!claimHasPosition(claim)) return false
  const x = Number(claim.position.x)
  const y = Number(claim.position.y)
  return x !== 0 || y !== 0
}

function claimHasBoundingBox(claim) {
  const position = claim?.position
  if (!position || typeof position !== 'object') return false

  const width = Number(position.width)
  const height = Number(position.height)
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
}

function claimQualityScore(claim) {
  let score = 0
  if (claimHasPosition(claim)) score += 100
  if (claimHasNonZeroPosition(claim)) score += 40
  if (claimHasBoundingBox(claim)) score += 20

  const confidence = Number(claim?.confidence)
  if (Number.isFinite(confidence)) {
    score += Math.max(0, Math.min(confidence, 1)) * 12
  }

  const textLength = String(claim?.text || '').trim().length
  if (textLength > 0) {
    score += Math.min(8, textLength / 35)
  }

  score += claimQualifierScore(claim?.text)

  return score
}

function claimDedupKey(claim) {
  const page = Math.max(1, Number(claim?.page) || 1)
  const region = claim?.region || ''
  const text = normalizeDedupText(claim?.text)
  // Include refNumbers so annotations with same text but different references are distinct
  const refs = Array.isArray(claim?.refNumbers) ? [...claim.refNumbers].sort((a, b) => a - b).join(',') : ''
  return `${page}|${region}|${text}|${refs}`
}

function choosePreferredClaim(existing, candidate) {
  const existingCompleteness = claimCompletenessScore(existing)
  const candidateCompleteness = claimCompletenessScore(candidate)
  if (candidateCompleteness !== existingCompleteness) {
    return candidateCompleteness > existingCompleteness ? candidate : existing
  }

  const existingQuality = claimQualityScore(existing)
  const candidateQuality = claimQualityScore(candidate)
  if (candidateQuality !== existingQuality) {
    return candidateQuality > existingQuality ? candidate : existing
  }

  const existingConfidence = Number(existing?.confidence)
  const candidateConfidence = Number(candidate?.confidence)
  if (Number.isFinite(existingConfidence) && Number.isFinite(candidateConfidence) && candidateConfidence !== existingConfidence) {
    return candidateConfidence > existingConfidence ? candidate : existing
  }

  const existingLength = String(existing?.text || '').trim().length
  const candidateLength = String(candidate?.text || '').trim().length
  if (candidateLength !== existingLength) {
    return candidateLength > existingLength ? candidate : existing
  }

  return existing
}

function areNearDuplicateClaims(claimA, claimB, options) {
  if (!claimA || !claimB) return false
  const pageA = Math.max(1, Number(claimA?.page) || 1)
  const pageB = Math.max(1, Number(claimB?.page) || 1)
  if (pageA !== pageB) return false

  // Never near-dedup across regions — slide and notes legitimately repeat content
  const regionA = claimA?.region || ''
  const regionB = claimB?.region || ''
  if (regionA && regionB && regionA !== regionB) return false

  const normalizedA = normalizeDedupText(claimA?.text)
  const normalizedB = normalizeDedupText(claimB?.text)
  if (!normalizedA || !normalizedB) return false
  if (normalizedA === normalizedB) {
    // Same text but different refNumbers = distinct annotations (e.g. [5] vs [1,6])
    const refsA = claimA?.refNumbers
    const refsB = claimB?.refNumbers
    if (refsA?.length || refsB?.length) {
      if (!refsA?.length || !refsB?.length) return false
      const setA = new Set(refsA)
      if (!refsB.every(r => setA.has(r)) || refsA.length !== refsB.length) return false
    }
    return true
  }

  if (hasConflictingNumericEvidence(claimA?.text, claimB?.text)) return false

  const { overlap, jaccard, contained, tokenCountA, tokenCountB, sharedTokens } = computeSimilarity(
    claimA?.text,
    claimB?.text
  )
  const nearOverlap = Number.isFinite(options?.nearOverlap) ? options.nearOverlap : DEFAULT_DEDUP_OPTIONS.nearOverlap
  const nearSimilarity = Number.isFinite(options?.nearSimilarity) ? options.nearSimilarity : DEFAULT_DEDUP_OPTIONS.nearSimilarity

  if (contained && overlap >= Math.max(0.7, nearOverlap - 0.12)) return true
  if (overlap >= nearOverlap && jaccard >= nearSimilarity) return true
  if (overlap >= Math.max(0.8, nearOverlap - 0.08) && jaccard >= Math.max(0.6, nearSimilarity - 0.12)) return true
  if (
    sharedTokens >= 4 &&
    Math.abs(tokenCountA - tokenCountB) >= 2 &&
    overlap >= Math.max(0.72, nearOverlap - 0.13) &&
    jaccard >= Math.max(0.48, nearSimilarity - 0.24)
  ) {
    return true
  }

  return false
}

function runExactDedup(claims) {
  const claimsByKey = new Map()
  let duplicateCount = 0

  for (const claim of claims) {
    const key = claimDedupKey(claim)
    const existing = claimsByKey.get(key)
    if (!existing) {
      claimsByKey.set(key, claim)
      continue
    }

    duplicateCount += 1
    claimsByKey.set(key, choosePreferredClaim(existing, claim))
  }

  const emittedKeys = new Set()
  const deduped = []
  for (const claim of claims) {
    const key = claimDedupKey(claim)
    if (emittedKeys.has(key)) continue
    emittedKeys.add(key)
    deduped.push(claimsByKey.get(key))
  }

  return { claims: deduped, duplicateCount }
}

function runNearDedup(claims, options) {
  const deduped = []
  let duplicateCount = 0
  const mergeEvents = options?.debug ? [] : null

  for (const candidate of claims) {
    let mergeIndex = -1
    for (let i = 0; i < deduped.length; i += 1) {
      if (areNearDuplicateClaims(deduped[i], candidate, options)) {
        mergeIndex = i
        break
      }
    }

    if (mergeIndex === -1) {
      deduped.push(candidate)
      continue
    }

    duplicateCount += 1
    const existing = deduped[mergeIndex]
    const winner = choosePreferredClaim(existing, candidate)
    deduped[mergeIndex] = winner

    if (mergeEvents) {
      mergeEvents.push({
        page: Math.max(1, Number(candidate?.page) || 1),
        winnerId: winner?.id || null,
        winnerText: String(winner?.text || '').slice(0, 220),
        mergedId: winner === existing ? candidate?.id || null : existing?.id || null,
        mergedText: String(winner === existing ? candidate?.text : existing?.text || '').slice(0, 220),
        reason: 'near-duplicate'
      })
    }
  }

  return { claims: deduped, duplicateCount, mergeEvents }
}

export function dedupeClaimsByPageAndText(claims, options = {}) {
  const dedupOptions = getClaimDedupOptions(options)

  if (!Array.isArray(claims) || claims.length === 0) {
    return {
      claims: [],
      uniqueCount: 0,
      duplicateCount: 0,
      exactDuplicateCount: 0,
      nearDuplicateCount: 0,
      mergeEvents: dedupOptions.debug ? [] : undefined
    }
  }

  const validClaims = claims.filter(claim => claim && typeof claim === 'object')
  if (validClaims.length === 0) {
    return {
      claims: [],
      uniqueCount: 0,
      duplicateCount: 0,
      exactDuplicateCount: 0,
      nearDuplicateCount: 0,
      mergeEvents: dedupOptions.debug ? [] : undefined
    }
  }

  const exact = runExactDedup(validClaims)
  let dedupedClaims = exact.claims
  let nearDuplicateCount = 0
  let mergeEvents = dedupOptions.debug ? [] : undefined

  if (dedupOptions.strategy === 'aggressive-near') {
    const near = runNearDedup(dedupedClaims, dedupOptions)
    dedupedClaims = near.claims
    nearDuplicateCount = near.duplicateCount
    if (dedupOptions.debug) {
      mergeEvents = near.mergeEvents || []
    }
  }

  const duplicateCount = exact.duplicateCount + nearDuplicateCount

  return {
    claims: dedupedClaims,
    uniqueCount: dedupedClaims.length,
    duplicateCount,
    exactDuplicateCount: exact.duplicateCount,
    nearDuplicateCount,
    mergeEvents
  }
}
