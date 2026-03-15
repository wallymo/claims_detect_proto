const MATCHER_STOP_WORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'that', 'this', 'are', 'was', 'were',
  'has', 'have', 'been', 'not', 'but', 'its', 'also', 'can', 'may', 'all',
  'doi', 'vol', 'etal', 'etc', 'study', 'studies', 'journal', 'review'
])

function stripLeadingCitationNumber(text) {
  return String(text || '').replace(/^\d+\.\s*/, '')
}

function normalizeMatchText(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/['’]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function extractKeywords(text) {
  return normalizeMatchText(text)
    .split(/\s+/)
    .filter(word => word.length > 2 && !MATCHER_STOP_WORDS.has(word))
}

function normalizeTokenList(values) {
  if (!Array.isArray(values)) return []
  return values
    .flatMap(value => extractKeywords(value))
    .filter(Boolean)
}

function countTokenOverlap(sourceTokens, candidateTokens) {
  if (!(sourceTokens instanceof Set) || sourceTokens.size === 0 || candidateTokens.length === 0) return 0
  let overlap = 0
  for (const token of new Set(candidateTokens)) {
    if (sourceTokens.has(token)) overlap += 1
  }
  return overlap
}

function hasPhrasePrefix(normalizedCitation, values, minTokens = 3) {
  if (!normalizedCitation || !Array.isArray(values) || values.length === 0) return false

  return values.some((value) => {
    const phraseTokens = extractKeywords(value)
    if (phraseTokens.length < minTokens) return false
    const prefix = phraseTokens.slice(0, Math.min(phraseTokens.length, 5)).join(' ')
    return prefix.length > 0 && normalizedCitation.includes(prefix)
  })
}

export function parseCitationText(text) {
  const stripped = stripLeadingCitationNumber(text)
  const doi = stripped.match(/10\.\d{4,}\/\S+/)?.[0]?.replace(/[.,;)\]]+$/, '')?.toLowerCase() || null
  const year = stripped.match(/\b(19|20)\d{2}\b/)?.[0] || null
  const normalized = normalizeMatchText(stripped)
  const firstAuthor = normalized.match(/^([a-z]+)/)?.[1] || null
  const keywords = extractKeywords(stripped)

  return {
    doi,
    year,
    firstAuthor,
    normalized,
    tokens: new Set(keywords)
  }
}

function scoreCitationMetadataMatch(parsed, meta) {
  if (!meta || !parsed) return 0

  const metaFirstAuthor = normalizeMatchText(meta.first_author || '').split(' ')[0] || null
  const authorTokens = normalizeTokenList(meta.author_tokens)
  const titleTokens = normalizeTokenList(meta.title_tokens)
  const journalTokens = normalizeTokenList(meta.journal_tokens)

  const firstAuthorMatch = Boolean(parsed.firstAuthor && metaFirstAuthor && parsed.firstAuthor === metaFirstAuthor)
  const yearMatch = Boolean(parsed.year && meta.year && String(parsed.year) === String(meta.year))
  const authorOverlap = countTokenOverlap(parsed.tokens, authorTokens)
  const titleOverlap = countTokenOverlap(parsed.tokens, titleTokens)
  const journalOverlap = countTokenOverlap(parsed.tokens, journalTokens)

  if (parsed.doi && meta.doi && parsed.doi === String(meta.doi).toLowerCase()) {
    return 1
  }

  if (firstAuthorMatch && yearMatch) {
    let score = 0.8
    if (journalOverlap > 0) score += 0.1
    if (titleOverlap > 0) score += 0.1
    return Math.min(score, 0.98)
  }

  if (firstAuthorMatch && (titleOverlap >= 2 || hasPhrasePrefix(parsed.normalized, meta.title_tokens, 2))) {
    return 0.78
  }

  if (authorOverlap >= 2 && (titleOverlap >= 2 || journalOverlap >= 1 || hasPhrasePrefix(parsed.normalized, meta.title_tokens, 2))) {
    return 0.76
  }

  if (authorOverlap >= 1 && (titleOverlap >= 2 || hasPhrasePrefix(parsed.normalized, meta.title_tokens, 2))) {
    return 0.72
  }

  if (authorOverlap >= 3) {
    return 0.66
  }

  if (firstAuthorMatch && (journalOverlap >= 1 || hasPhrasePrefix(parsed.normalized, meta.journal_tokens, 1))) {
    return 0.68
  }

  if (authorOverlap >= 1 && yearMatch) {
    return 0.6
  }

  return 0
}

export function matchCitationToLibrary(citationText, referenceDocuments) {
  if (!citationText || !referenceDocuments.length) return null

  const parsed = parseCitationText(citationText)
  let bestMatch = null
  let bestScore = 0

  for (const ref of referenceDocuments) {
    const meta = ref.citationMetadata
    let score = scoreCitationMetadataMatch(parsed, meta)

    if (score === 0) {
      const normalized = parsed.normalized
      const refName = normalizeMatchText(ref.name || '')
      const refOriginal = normalizeMatchText(ref.originalName || '')

      if (normalized === refName || normalized === refOriginal) {
        score = 0.95
      }

      if (score === 0) {
        if (refName && refName.length >= 4 && (normalized.includes(refName) || refName.includes(normalized))) {
          score = 0.7
        } else if (refOriginal && refOriginal.length >= 4 && (normalized.includes(refOriginal) || refOriginal.includes(normalized))) {
          score = 0.7
        }
      }

      if (score === 0) {
        const citationWords = parsed.tokens
        if (citationWords.size > 0) {
          for (const candidate of [refName, refOriginal]) {
            if (!candidate) continue
            const candidateWords = extractKeywords(candidate)
            if (candidateWords.length === 0) continue
            const overlap = candidateWords.filter(word => citationWords.has(word)).length
            const candidateScore = overlap / candidateWords.length
            if (candidateScore > score && candidateScore >= 0.6 && overlap >= 2) {
              score = candidateScore * 0.5
            }
          }
        }
      }
    }

    if (score > bestScore && score >= 0.5) {
      bestScore = score
      bestMatch = ref
    }
  }

  return bestMatch
}
