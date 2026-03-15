/**
 * Match claim text against extracted PDF text to find position.
 * Returns x/y (center) and bounding box as percentages (0-100) of page dimensions.
 *
 * Strategy: "First-Words Anchor" - find the first few words of the claim
 * and return a tight bounding box around just those words, not the entire claim.
 */

import { logger } from './logger.js'

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
 * Extract a short prefix from the claim for tight anchor matching.
 * Takes first 5 tokens, or stops at sentence-ending punctuation.
 */
function extractClaimPrefix(claimText, maxTokens = 5) {
  if (!claimText) return { raw: '', normalized: '', tokens: [] }

  // Stop at sentence boundaries if they occur early
  const sentenceEnd = claimText.search(/[.!?]/)
  const truncated = sentenceEnd > 0 && sentenceEnd < 60
    ? claimText.slice(0, sentenceEnd)
    : claimText

  const normalized = normalizeText(truncated)
  const allTokens = normalized.split(' ').filter(Boolean)
  const tokens = allTokens.slice(0, maxTokens)

  return {
    raw: claimText.slice(0, 80), // for debugging
    normalized: tokens.join(' '),
    tokens
  }
}

/**
 * Find where a prefix starts within a line's items.
 * Returns the subset of items that contain the prefix, or null if not found.
 * If requiredNumbers is provided, line must also contain those numbers.
 */
function findPrefixInLine(line, prefixTokens, requiredNumbers = []) {
  if (!line.items?.length || !prefixTokens.length) return null

  const lineTextNorm = normalizeText(line.text)
  const prefixStr = prefixTokens.join(' ')

  // Check if line contains the prefix
  if (!lineTextNorm.includes(prefixStr)) return null

  // If we have required numbers, line must contain at least one
  if (requiredNumbers.length > 0) {
    const lineNumbers = extractNumbers(line.text)
    const hasRequiredNumber = requiredNumbers.some(n => lineNumbers.includes(n))
    if (!hasRequiredNumber) return null
  }

  // Find which items contain the prefix tokens
  // Walk through items accumulating tokens until we've covered the prefix
  const matchedItems = []
  let tokensFound = 0

  for (const item of line.items) {
    const itemTokens = normalizeText(item.str).split(' ').filter(Boolean)

    for (const tok of itemTokens) {
      if (tokensFound < prefixTokens.length && tok === prefixTokens[tokensFound]) {
        tokensFound++
        if (!matchedItems.includes(item)) {
          matchedItems.push(item)
        }
      } else if (tokensFound > 0 && tokensFound < prefixTokens.length) {
        // Sequence broken, but we might still have partial match
        // Keep the items we've found so far
      }
    }

    // Stop once we've matched all prefix tokens
    if (tokensFound >= prefixTokens.length) break
  }

  // Require at least 60% of prefix tokens matched
  if (tokensFound < prefixTokens.length * 0.6) return null

  return matchedItems.length > 0 ? matchedItems : null
}

const extractNumbers = (text) => (text.match(/\d+(?:\.\d+)?/g) || []).map(Number)

const clamp01 = (v) => Math.max(0, Math.min(1, v))
const clampPercent = (v) => Math.max(0, Math.min(100, v))
const SLIDE_LANE_X_PCT = {
  left: 9,
  right: 91
}

function jaccard(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0
  const setA = new Set(tokensA)
  const setB = new Set(tokensB)
  const intersection = [...setA].filter(t => setB.has(t)).length
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Compute bounding box for a set of PDF items in absolute coordinates
 */
function boundsFromItems(items) {
  if (!items.length) return null
  const xMin = Math.min(...items.map(it => it.x))
  const xMax = Math.max(...items.map(it => it.x + (it.width || 0)))
  // item.y is baseline after flip; subtract height to get top
  const yMin = Math.min(...items.map(it => it.y - (it.height || 0)))
  const yMax = Math.max(...items.map(it => it.y))
  const width = xMax - xMin
  const height = yMax - yMin
  return {
    xMin,
    xMax,
    yMin,
    yMax,
    width,
    height,
    cx: xMin + width / 2,
    cy: yMin + height / 2
  }
}

/**
 * Find claim start position using prefix-anchor matching.
 * Returns a tight bounding box around just the first few words.
 * Uses numbers from the claim to disambiguate duplicate text.
 * @returns {{ position, pageNum, score, confidence } | null}
 */
function findClaimStartPosition(claimText, hintPage, extractedPages) {
  // Extract numbers from claim for disambiguation
  const claimNumbers = extractNumbers(claimText)

  // Use longer prefix (7 tokens) if claim has numbers, otherwise 5
  const prefixLength = claimNumbers.length > 0 ? 7 : 5
  const prefix = extractClaimPrefix(claimText, prefixLength)
  if (!prefix.tokens.length) return null

  let bestMatch = null
  let matchWithNumbers = null  // Track best match that also has numbers

  for (const page of extractedPages) {
    if (!page.lines?.length) continue

    // Prefer the hinted page, but search all
    const pageBias = page.pageNum === hintPage ? 2 : 0

    for (const line of page.lines) {
      // Need items array on line for tight bounds
      if (!line.itemIndices?.length || !page.items) continue

      // Reconstruct items for this line
      const lineItems = line.itemIndices.map(idx => page.items[idx]).filter(Boolean)
      const lineWithItems = { ...line, items: lineItems }

      // First try: match with required numbers (more precise)
      let matchedItems = null
      let hasNumberMatch = false

      if (claimNumbers.length > 0) {
        matchedItems = findPrefixInLine(lineWithItems, prefix.tokens, claimNumbers)
        if (matchedItems) hasNumberMatch = true
      }

      // Fallback: match without number requirement
      if (!matchedItems) {
        matchedItems = findPrefixInLine(lineWithItems, prefix.tokens, [])
      }

      if (!matchedItems) continue

      // Compute tight bounds from just the matched items
      const bounds = boundsFromItems(matchedItems)
      if (!bounds) continue

      const position = {
        x: (bounds.cx / page.width) * 100,
        y: (bounds.cy / page.height) * 100,
        width: (bounds.width / page.width) * 100,
        height: (bounds.height / page.height) * 100
      }

      // Score: higher is better. Bonus for number match and tight bounds
      const numberBonus = hasNumberMatch ? 3 : 0
      const tightBonus = matchedItems.length <= 3 ? 1 : 0
      const score = 10 + pageBias + numberBonus + tightBonus
      const confidence = clamp01(score / 15)

      const candidate = {
        position,
        pageNum: page.pageNum,
        score,
        confidence,
        source: hasNumberMatch ? 'prefix-anchor-numbers' : 'prefix-anchor'
      }

      // Track best overall and best with numbers separately
      if (hasNumberMatch && page.pageNum === hintPage) {
        // Perfect match: right page + has numbers
        return candidate
      }

      if (hasNumberMatch && (!matchWithNumbers || score > matchWithNumbers.score)) {
        matchWithNumbers = candidate
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = candidate
      }
    }
  }

  // Prefer match with numbers if available, otherwise best overall
  return matchWithNumbers || bestMatch
}

/**
 * Score a window of text against the claim tokens/numbers
 */
function scoreWindow({ claimTokens, claimNumbers, windowText, windowTokens, windowNumbers }) {
  const tokenHits = claimTokens.filter(tok => tok.length > 2 && windowTokens.includes(tok)).length
  const tokenHitRatio = claimTokens.length ? tokenHits / claimTokens.length : 0

  const numberHits = claimNumbers.filter(n => windowNumbers.includes(n)).length
  const allNumbersPresent = claimNumbers.length > 0 && numberHits === claimNumbers.length

  const startsWithFirst = windowTokens[0] === claimTokens[0]
  const firstPair = claimTokens.slice(0, 2).join(' ')
  const prefix = claimTokens.slice(0, 4).join(' ')
  const pairHit = firstPair && windowText.includes(firstPair)
  const prefixHit = prefix && windowText.includes(prefix)

  const jacc = jaccard(claimTokens, windowTokens)

  let score = 0
  score += tokenHitRatio * 6
  score += numberHits * 3
  score += allNumbersPresent ? 2 : 0
  score += startsWithFirst ? 1 : 0
  score += pairHit ? 1 : 0
  score += prefixHit ? 2 : 0
  score += jacc * 3

  // Strong bonus for near-exact substring containment
  const normalizedClaim = claimTokens.join(' ')
  if (normalizedClaim && windowText.includes(normalizedClaim)) {
    score += 4
  }

  return score
}

/**
 * Find best match inside a line (tightest box)
 */
function scoreLine(line, claimTokens, claimNumbers, normalizedClaim) {
  const lineTextNorm = normalizeText(line.text)
  if (!lineTextNorm) return null

  const lineTokens = lineTextNorm.split(' ').filter(Boolean)
  const jacc = jaccard(claimTokens, lineTokens)
  const numberHits = claimNumbers.filter(n => lineTokens.includes(String(n))).length
  const containsExact = normalizedClaim && lineTextNorm.includes(normalizedClaim)

  const score = (containsExact ? 12 : 0) + jacc * 6 + numberHits * 3
  if (score <= 0) return null

  return {
    score,
    bounds: {
      xMin: line.x,
      xMax: line.x + line.width,
      yMin: line.y - line.height,
      yMax: line.y,
      width: line.width,
      height: line.height,
      cx: line.x + line.width / 2,
      cy: line.y - line.height / 2
    }
  }
}

/**
 * Identify which items in the window contributed to the match
 */
function matchedItems(windowItems, claimTokens, claimNumbers) {
  const hits = windowItems.filter(it => {
    const tokens = normalizeText(it.str).split(' ').filter(Boolean)
    const tokenHit = tokens.some(t => t.length > 2 && claimTokens.includes(t))
    const numberHit = extractNumbers(it.str).some(n => claimNumbers.includes(n))
    return tokenHit || numberHit
  })
  return hits.length ? hits : windowItems // fallback to full window if nothing matched
}

function getPageForClaim(extractedPages, pageNum) {
  return extractedPages.find(page => page.pageNum === pageNum) || null
}

function lineCenterXPct(line, page) {
  if (!page?.width) return 0
  return ((line.x + (line.width / 2)) / page.width) * 100
}

function lineCenterYPct(line, page) {
  if (!page?.height) return 0
  return ((line.y - (line.height / 2)) / page.height) * 100
}

function getRegionBoundaryPct(page) {
  if (Number.isFinite(page?.notesBoundaryY) && page.height > 0) {
    return clampPercent((page.notesBoundaryY / page.height) * 100)
  }
  return 55
}

function isLineInRegion(line, page, region) {
  const centerY = lineCenterYPct(line, page)
  const boundaryPct = getRegionBoundaryPct(page)
  return region === 'notes' ? centerY >= boundaryPct : centerY < boundaryPct
}

function inferLaneFromHint(hintXPct) {
  return Number.isFinite(hintXPct) && hintXPct >= 55 ? 'right' : 'left'
}

function classifyLineLane(line, page) {
  const centerXPct = lineCenterXPct(line, page)
  if (centerXPct >= 60) return 'right'
  if (centerXPct <= 40) return 'left'
  return 'center'
}

function scoreSlideLine(line, page, claimTokens, hintYPct, hintXPct) {
  const lineTextNorm = normalizeText(line.text)
  if (!lineTextNorm) return -Infinity

  const lineTokens = lineTextNorm.split(' ').filter(Boolean)
  const meaningfulClaimTokens = claimTokens.filter(token => token.length > 2)
  const tokenHits = meaningfulClaimTokens.filter(token => lineTokens.includes(token)).length
  const tokenRatio = meaningfulClaimTokens.length > 0 ? tokenHits / meaningfulClaimTokens.length : 0
  const prefix = claimTokens.slice(0, 3).join(' ')
  const prefixHit = prefix && lineTextNorm.includes(prefix)
  const overlap = jaccard(claimTokens, lineTokens)
  const yPenalty = Number.isFinite(hintYPct)
    ? Math.min(Math.abs(lineCenterYPct(line, page) - hintYPct) / 18, 2.4)
    : 0
  const xPenalty = Number.isFinite(hintXPct)
    ? Math.min(Math.abs(lineCenterXPct(line, page) - hintXPct) / 35, 1.2)
    : 0
  const widePenalty = page?.width > 0 && ((line.width / page.width) * 100) > 60 ? 0.75 : 0

  return (tokenRatio * 5) + (overlap * 3) + (prefixHit ? 1.5 : 0) - yPenalty - xPenalty - widePenalty
}

function chooseNearestLineByY(lines, page, hintYPct) {
  if (!lines.length) return null
  if (!Number.isFinite(hintYPct)) return lines[0]

  return [...lines].sort((a, b) => (
    Math.abs(lineCenterYPct(a, page) - hintYPct) - Math.abs(lineCenterYPct(b, page) - hintYPct)
  ))[0]
}

function resolveLane(line, page, hintXPct) {
  const lineLane = line ? classifyLineLane(line, page) : 'center'
  if (lineLane === 'left' || lineLane === 'right') return lineLane
  return inferLaneFromHint(hintXPct)
}

function findSlideLaneAnchor(claim, extractedPages) {
  const pageNum = Number(claim?.page) || 1
  const page = getPageForClaim(extractedPages, pageNum)
  if (!page?.lines?.length) return null

  const slideLines = page.lines.filter(line => isLineInRegion(line, page, 'slide'))
  if (!slideLines.length) return null

  const hintXPct = Number(claim?.position?.x)
  const hintYPct = Number(claim?.position?.y)

  const claimText = claim?.text || claim?.claim || ''
  const claimTokens = normalizeText(claimText).split(' ').filter(Boolean)
  let bestLine = null
  let bestScore = -Infinity

  if (claimTokens.length > 0) {
    slideLines.forEach((line) => {
      const score = scoreSlideLine(line, page, claimTokens, hintYPct, hintXPct)
      if (score > bestScore) {
        bestScore = score
        bestLine = line
      }
    })
  }

  if (!bestLine || bestScore < 1.8) {
    bestLine = chooseNearestLineByY(slideLines, page, hintYPct)
  }

  if (!bestLine) return null

  const lane = resolveLane(bestLine, page, hintXPct)
  const y = clampPercent(lineCenterYPct(bestLine, page))
  const x = SLIDE_LANE_X_PCT[lane]
  const score = Number.isFinite(bestScore) ? bestScore : 0
  const confidence = bestScore >= 1.8 ? 0.64 : 0.5

  return {
    position: {
      x,
      y,
      width: 0,
      height: 0,
      lane
    },
    pageNum,
    score,
    confidence,
    source: 'coarse-slide-anchor'
  }
}

/**
 * Find the best matching position, scanning all pages but biasing toward the hinted pageNum.
 * Uses prefix-anchor matching first for tight bounds, falls back to fuzzy matching.
 * @returns { { position: {x, y, width, height, source, confidence}, pageNum, score } | null }
 */
export function findClaimPosition(claimText, pageNum, extractedPages) {
  if (!claimText || !extractedPages?.length) return null

  const hintPage = Number(pageNum) || 1

  // FIRST: Try prefix-anchor matching for tight bounds
  const prefixMatch = findClaimStartPosition(claimText, hintPage, extractedPages)
  if (prefixMatch && prefixMatch.score >= 10) {
    return prefixMatch
  }

  // FALLBACK: Original fuzzy matching if prefix didn't work
  const normalizedClaim = normalizeText(claimText)
  const claimTokens = normalizedClaim.split(' ').filter(Boolean)
  const claimNumbers = extractNumbers(claimText)
  const windowSize = Math.max(8, Math.min(18, claimTokens.length + 6))

  let bestCandidate = prefixMatch // Keep prefix match as baseline if it exists

  extractedPages.forEach(page => {
    if (!page.items?.length) return

    // Pass 1: line-level exact/near matches for tight boxes
    if (page.lines?.length) {
      page.lines.forEach(line => {
        const lineResult = scoreLine(line, claimTokens, claimNumbers, normalizedClaim)
        if (!lineResult) return
        const position = {
          x: (lineResult.bounds.cx / page.width) * 100,
          y: (lineResult.bounds.cy / page.height) * 100,
          width: (lineResult.bounds.width / page.width) * 100,
          height: (lineResult.bounds.height / page.height) * 100
        }
        const finalScore = lineResult.score + (page.pageNum === hintPage ? 0.8 : 0)
        const confidence = clamp01(finalScore / 12)
        if (!bestCandidate || finalScore > bestCandidate.score) {
          bestCandidate = { position, pageNum: page.pageNum, score: finalScore, confidence }
        }
      })
    }

    let bestOnPage = { score: 0, items: [] }

    for (let i = 0; i < page.items.length; i++) {
      const windowItems = page.items.slice(i, i + windowSize)
      const windowText = normalizeText(windowItems.map(it => it.str).join(' '))
      if (!windowText) continue

      const windowTokens = windowText.split(' ').filter(Boolean)
      const windowNumbers = windowItems.flatMap(it => extractNumbers(it.str))

      const score = scoreWindow({ claimTokens, claimNumbers, windowText, windowTokens, windowNumbers })

      if (score > bestOnPage.score) {
        bestOnPage = { score, items: windowItems, windowText }
      }
    }

    if (bestOnPage.items.length === 0) return

    const hitSet = matchedItems(bestOnPage.items, claimTokens, claimNumbers)
    const bounds = boundsFromItems(hitSet)
    if (!bounds) return

    const position = {
      x: (bounds.cx / page.width) * 100,
      y: (bounds.cy / page.height) * 100,
      width: (bounds.width / page.width) * 100,
      height: (bounds.height / page.height) * 100
    }

    // Bias toward hinted page with a small bonus
    const pageBias = page.pageNum === hintPage ? 0.8 : 0
    const finalScore = bestOnPage.score + pageBias
    const confidence = clamp01(finalScore / 12) // heuristic normalization

    if (!bestCandidate || finalScore > bestCandidate.score) {
      bestCandidate = {
        position,
        pageNum: page.pageNum,
        score: finalScore,
        confidence
      }
    }
  })

  return bestCandidate
}

/**
 * Enrich an array of claims with position data
 * @param {Array} claims - Claims from Gemini (must have text and page)
 * @param {Array} extractedPages - Output from extractTextWithPositions
 * @returns {Array} - Claims with position: { x, y } added
 */
export function enrichClaimsWithPositions(claims, extractedPages) {
  return claims.map((claim, index) => {
    const pageNumber = Number(claim.page) || 1
    const match = findClaimPosition(claim.text, pageNumber, extractedPages)

    const position = match?.position
    const usedPage = match?.pageNum || pageNumber
    const confidence = match?.confidence ?? 0
    const score = match?.score ?? 0

    if (!position) {
      logger.debug('Claim position fallback', { id: claim.id, pageHint: pageNumber, text: claim.text?.slice(0, 80) })
    }

    return {
      ...claim,
      page: usedPage,
      position: position
        ? { ...position, source: 'extracted', confidence, score }
        : {
            // Fallback: place pin comfortably left of the text line so numerals don't overlap copy
            x: 12,
            y: 12 + (index * 9) % 76,
            width: 0,
            height: 0,
            source: 'fallback',
            confidence: 0,
            score: 0
          }
    }
  })
}

export function alignClaimsToSlideLayout(claims, extractedPages) {
  if (!Array.isArray(claims) || claims.length === 0 || !Array.isArray(extractedPages) || extractedPages.length === 0) {
    return claims
  }

  let changed = false

  const nextClaims = claims.map((claim) => {
    if (claim?.region !== 'slide' || claim?.globalSpot || claim?.contentType === 'global' || claim?.position?.source === 'manual') {
      return claim
    }

    const anchor = findSlideLaneAnchor(claim, extractedPages)
    if (!anchor?.position) return claim

    const currentPosition = claim.position || {}
    const nextPosition = {
      ...currentPosition,
      ...anchor.position,
      source: anchor.source,
      confidence: anchor.confidence,
      score: anchor.score
    }

    const currentSource = currentPosition.source || ''
    const currentX = Number(currentPosition.x)
    const currentY = Number(currentPosition.y)
    const nextX = Number(nextPosition.x)
    const nextY = Number(nextPosition.y)

    const shouldReplace = currentSource !== 'coarse-slide-anchor'
      || Math.abs(currentX - nextX) > 0.25
      || Math.abs(currentY - nextY) > 0.25

    if (!shouldReplace) return claim

    changed = true
    return {
      ...claim,
      page: anchor.pageNum || claim.page,
      position: nextPosition
    }
  })

  return changed ? nextClaims : claims
}

/**
 * Assign a stable global index across pages (1-based), sorted by page then original order
 */
export function addGlobalIndices(claims) {
  const sorted = [...claims]
    .map((claim, idx) => ({ ...claim, __origOrder: idx }))
    .sort((a, b) => {
      const pageDiff = a.page - b.page
      if (pageDiff !== 0) return pageDiff
      return a.__origOrder - b.__origOrder
    })

  const withIndex = sorted.map((claim, idx) => ({ ...claim, globalIndex: idx + 1 }))

  // Restore original order but keep globalIndex
  withIndex.sort((a, b) => a.__origOrder - b.__origOrder)
  return withIndex.map(({ __origOrder, ...rest }) => rest)
}
