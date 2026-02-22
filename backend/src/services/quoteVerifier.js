/**
 * Verify that an AI-generated quote actually exists in the reference text.
 * Returns { status, charOffset, matchedText } where status is:
 *   - 'verified': exact or near-exact match found
 *   - 'partial': key numeric tokens found in same paragraph
 *   - 'unverified': no match
 */
export function verifyQuote(quote, referenceText) {
  if (!quote || !referenceText) {
    return { status: 'unverified', charOffset: null, matchedText: null }
  }

  const normQuote = normalize(quote)
  const normRef = normalize(referenceText)

  if (!normQuote || !normRef) {
    return { status: 'unverified', charOffset: null, matchedText: null }
  }

  const exactIndex = normRef.indexOf(normQuote)
  if (exactIndex !== -1) {
    return { status: 'verified', charOffset: exactIndex, matchedText: normQuote }
  }

  const windowSize = Math.min(normQuote.length * 2, normRef.length)
  let bestLcsRatio = 0
  let bestOffset = 0

  const step = Math.max(1, Math.floor(normQuote.length / 4))
  for (let start = 0; start <= normRef.length - normQuote.length / 2; start += step) {
    const window = normRef.slice(start, start + windowSize)
    const lcsLen = longestCommonSubsequenceLength(normQuote, window)
    const ratio = lcsLen / normQuote.length
    if (ratio > bestLcsRatio) {
      bestLcsRatio = ratio
      bestOffset = start
    }
  }

  if (bestLcsRatio >= 0.80) {
    return { status: 'verified', charOffset: bestOffset, matchedText: null }
  }

  const quoteNumerics = extractNumerics(quote)
  if (quoteNumerics.length > 0) {
    const paragraphs = referenceText.split(/\n\s*\n|\.\s+/)
    for (let i = 0; i < paragraphs.length; i += 1) {
      const paraLower = paragraphs[i].toLowerCase()
      const found = quoteNumerics.filter(n => paraLower.includes(n))
      if (found.length === quoteNumerics.length) {
        const offset = referenceText.indexOf(paragraphs[i])
        return { status: 'partial', charOffset: offset >= 0 ? offset : null, matchedText: null }
      }
    }
  }

  return { status: 'unverified', charOffset: null, matchedText: null }
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9%.<>=\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractNumerics(text) {
  const nums = new Set()
  const lower = text.toLowerCase()
  const matches = lower.match(/\b\d+(?:\.\d+)?%?\b/g) || []
  matches.forEach(m => nums.add(m))
  const pvals = lower.match(/p\s*[<>=]\s*0?\.\d+/g) || []
  pvals.forEach(m => nums.add(m.replace(/\s+/g, '')))
  return [...nums]
}

function longestCommonSubsequenceLength(a, b) {
  if (!a || !b) return 0
  const short = a.length <= b.length ? a : b
  const long = a.length <= b.length ? b : a
  const prev = new Uint16Array(short.length + 1)
  const curr = new Uint16Array(short.length + 1)

  for (let i = 1; i <= long.length; i += 1) {
    for (let j = 1; j <= short.length; j += 1) {
      if (long[i - 1] === short[j - 1]) {
        curr[j] = prev[j - 1] + 1
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1])
      }
    }
    prev.set(curr)
    curr.fill(0)
  }
  return prev[short.length]
}

