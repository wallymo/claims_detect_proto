function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function extractClaimTerms(claimText) {
  const claim = normalize(claimText)
  const tokenMatches = claim.match(/[a-z0-9][a-z0-9.%/-]{2,}/g) || []
  const tokens = [...new Set(tokenMatches.filter(token => token.length > 2))]
  const numeric = [...new Set(
    claim.match(/\b\d+(?:\.\d+)?%?|\bp\s*[<=>]\s*0?\.\d+\b|\bn\s*[=:]?\s*\d+\b|\bhr\s*0?\.\d+\b/g) || []
  )]
  return { tokens, numeric }
}

export function scoreTextOverlap(claimTerms, text) {
  const normalizedText = normalize(text)
  if (!normalizedText) return 0

  const tokenHits = claimTerms.tokens.filter(token => normalizedText.includes(token)).length
  const numericHits = claimTerms.numeric.filter(token => normalizedText.includes(normalize(token))).length

  const tokenScore = claimTerms.tokens.length > 0
    ? Math.min(tokenHits / claimTerms.tokens.length, 1)
    : 0
  const numericScore = claimTerms.numeric.length > 0
    ? Math.min(numericHits / claimTerms.numeric.length, 1)
    : 0

  return clamp((tokenScore * 0.65) + (numericScore * 0.35))
}

export function buildLlamaPageScores(claimText, parsedPages) {
  const claimTerms = extractClaimTerms(claimText)
  const scores = new Map()

  for (const page of Array.isArray(parsedPages) ? parsedPages : []) {
    const pageNumber = Number(page?.page ?? page?.page_number)
    if (!Number.isFinite(pageNumber)) continue
    const sourceText = [page?.markdown, page?.text].filter(Boolean).join('\n')
    scores.set(pageNumber, scoreTextOverlap(claimTerms, sourceText))
  }

  return scores
}

function computeTypeBoost(candidate, claimTerms) {
  const type = String(candidate?.type || '').toLowerCase()
  if (!claimTerms.numeric.length) return 0
  if (['structured_box', 'table', 'figure', 'chart', 'diagram'].includes(type)) return 0.08
  return 0
}

function computeSupportStrength(score) {
  if (score >= 0.78) return 'direct_support'
  if (score >= 0.45) return 'partial_support'
  return 'weak_support'
}

function buildRationale(candidate, score, pageScore) {
  const type = String(candidate?.type || 'text')
  const page = candidate?.page_number || '?'
  if (pageScore > 0.6) {
    return `Strong claim overlap on page ${page}; ${type} region prioritized with LlamaParse page context.`
  }
  if (score >= 0.45) {
    return `Moderate keyword overlap on page ${page}; ${type} region kept as a useful candidate.`
  }
  return `Low-overlap ${type} region on page ${page}; included as a weaker fallback candidate.`
}

function dedupeRankedCandidates(ranked) {
  const seen = new Set()
  const result = []

  for (const item of ranked) {
    const textKey = normalize(item?.candidate?.text || '').slice(0, 120)
    const rectKey = JSON.stringify(item?.candidate?.rects || []).slice(0, 200)
    const key = `${item?.candidate?.page_number || ''}|${item?.candidate?.type || ''}|${textKey}|${rectKey}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }

  return result
}

export function selectCandidatesWithLlamaParse(claimText, candidates, parsedPages, limit = 6) {
  const claimTerms = extractClaimTerms(claimText)
  const pageScores = buildLlamaPageScores(claimText, parsedPages)

  const ranked = (Array.isArray(candidates) ? candidates : []).map((candidate) => {
    const candidateScore = scoreTextOverlap(claimTerms, candidate?.text || '')
    const baseScore = Number.isFinite(candidate?.pre_score) ? candidate.pre_score : candidateScore
    const pageScore = pageScores.get(candidate?.page_number) || 0
    const typeBoost = computeTypeBoost(candidate, claimTerms)
    const finalScore = clamp((baseScore * 0.55) + (candidateScore * 0.25) + (pageScore * 0.20) + typeBoost)

    return {
      candidate,
      score: finalScore,
      support_strength: computeSupportStrength(finalScore),
      rationale: buildRationale(candidate, finalScore, pageScore),
      page_score: pageScore,
      candidate_score: candidateScore
    }
  })

  ranked.sort((a, b) => b.score - a.score)

  return dedupeRankedCandidates(ranked)
    .slice(0, limit)
    .map((item) => ({
      candidate_id: item.candidate.candidate_id,
      score: item.score,
      support_strength: item.support_strength,
      rationale: item.rationale,
      debug: {
        page_score: item.page_score,
        candidate_score: item.candidate_score,
        pre_score: Number.isFinite(item.candidate?.pre_score) ? item.candidate.pre_score : null
      }
    }))
}
