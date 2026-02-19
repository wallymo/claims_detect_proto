/**
 * Claim deduplication helpers
 *
 * Dedupe policy:
 * - Duplicate if SAME page + same normalized text
 * - Keep cross-page repeats (same sentence on different pages)
 */

const SUPERSCRIPT_MARKERS_RE = /[\u00B9\u00B2\u00B3\u2070-\u2079]+/g
const CITATION_SYMBOLS_RE = /[†‡§]+/g
const WRAPPING_QUOTES_RE = /["'`“”‘’]/g
const TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/g
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g
const DASH_VARIANTS_RE = /[‐‑–—−]/g

export function normalizeDedupText(text) {
  const normalized = String(text || '')
    .normalize('NFKC')
    .replace(ZERO_WIDTH_RE, '')
    .replace(SUPERSCRIPT_MARKERS_RE, '')
    .replace(CITATION_SYMBOLS_RE, '')
    .replace(WRAPPING_QUOTES_RE, '')
    .replace(DASH_VARIANTS_RE, '-')
    .replace(TRAILING_PUNCTUATION_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  // Canonical token stream: ignore punctuation/symbol jitter while preserving
  // word order and numeric tokens (including percentages).
  const tokens = normalized.match(/[\p{L}\p{N}%]+(?:[.-][\p{L}\p{N}%]+)*/gu) || []
  return tokens.join(' ')
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
    score += Math.max(0, Math.min(confidence, 1)) * 10
  }

  const textLength = String(claim?.text || '').trim().length
  if (textLength > 0) {
    score += Math.min(5, textLength / 40)
  }

  return score
}

function claimDedupKey(claim) {
  const page = Math.max(1, Number(claim?.page) || 1)
  const text = normalizeDedupText(claim?.text)
  return `${page}|${text}`
}

export function dedupeClaimsByPageAndText(claims) {
  if (!Array.isArray(claims) || claims.length === 0) {
    return { claims: [], uniqueCount: 0, duplicateCount: 0 }
  }

  const claimsByKey = new Map()
  let duplicateCount = 0

  for (const claim of claims) {
    if (!claim || typeof claim !== 'object') continue

    const key = claimDedupKey(claim)
    const existing = claimsByKey.get(key)
    if (!existing) {
      claimsByKey.set(key, claim)
      continue
    }

    duplicateCount += 1
    const existingScore = claimQualityScore(existing)
    const nextScore = claimQualityScore(claim)
    if (nextScore > existingScore) {
      claimsByKey.set(key, claim)
    }
  }

  // Preserve original order of first-seen key while honoring replacement by best-quality claim.
  const emittedKeys = new Set()
  const deduped = []
  for (const claim of claims) {
    if (!claim || typeof claim !== 'object') continue
    const key = claimDedupKey(claim)
    if (emittedKeys.has(key)) continue
    emittedKeys.add(key)
    deduped.push(claimsByKey.get(key))
  }

  return {
    claims: deduped,
    uniqueCount: deduped.length,
    duplicateCount
  }
}
