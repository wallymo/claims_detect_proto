/**
 * Citation Metadata Extractor
 *
 * Extracts structured citation metadata (authors, year, journal, DOI, title)
 * from reference document filenames and first-page content text.
 * Used for fuzzy matching between AI-detected references and the brand library.
 */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'this', 'that', 'are', 'was', 'were',
  'been', 'have', 'has', 'had', 'not', 'but', 'all', 'can', 'will', 'one',
  'two', 'may', 'use', 'used', 'each', 'which', 'their', 'about', 'other',
  'into', 'more', 'some', 'such', 'only', 'also', 'than', 'then', 'its',
  'over', 'after', 'under', 'between', 'our', 'these', 'those', 'most',
  'research', 'study', 'paper', 'article', 'review', 'analysis', 'results',
  'methods', 'received', 'revised', 'accepted', 'published', 'open', 'access',
  'original', 'journal', 'doi', 'vol', 'volume', 'issue', 'pages', 'http',
  'https', 'www', 'com', 'org'
])

const SECTION_HEADERS_RE = /\b(Abstract|Background|Introduction|HIGHLIGHTS|INDICATIONS)\b/i

/**
 * Parse pageBoundaries from JSON string or return as-is if already an array.
 * Returns null on failure.
 */
function parseBoundaries(pageBoundaries) {
  if (!pageBoundaries) return null
  if (Array.isArray(pageBoundaries)) return pageBoundaries
  if (typeof pageBoundaries === 'string') {
    try {
      const parsed = JSON.parse(pageBoundaries)
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

/**
 * Get first-page text from contentText using pageBoundaries.
 * Falls back to first 2000 chars if boundaries unavailable.
 */
function getFirstPageText(contentText, pageBoundaries) {
  if (!contentText) return ''
  const bounds = parseBoundaries(pageBoundaries)
  if (bounds && bounds.length > 0) {
    const first = bounds[0]
    if (first && typeof first.startChar === 'number' && typeof first.endChar === 'number') {
      return contentText.slice(first.startChar, first.endChar)
    }
  }
  return contentText.slice(0, 2000)
}

/**
 * Strip timestamp prefix (e.g. '1770740809209_') from filename.
 */
function stripTimestamp(name) {
  return name.replace(/^\d+_/, '')
}

/**
 * Extract first author surname from filename.
 * e.g. '1770740809209_bragazzi_nl_j_neuroinflammation_2021.pdf' → 'bragazzi'
 */
function extractFirstAuthor(filename) {
  if (!filename) return null
  const stripped = stripTimestamp(filename)
  const noExt = stripped.replace(/\.[^.]+$/, '')
  const tokens = noExt.split(/[_\-\s.]+/)
  const first = tokens[0]
  return first ? first.toLowerCase() : null
}

/**
 * Extract author surname tokens from first-page text.
 * Looks for uppercase words before section headers (Abstract, Background, etc.).
 */
function extractAuthorTokens(firstPageText) {
  if (!firstPageText) return []

  // Find text before first section header
  const headerMatch = firstPageText.match(SECTION_HEADERS_RE)
  const authorRegion = headerMatch
    ? firstPageText.slice(0, headerMatch.index)
    : firstPageText.slice(0, 1200)

  // Match words that start with uppercase, at least 2 chars
  const candidates = authorRegion.match(/\b[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ‑'-]{1,}/g)
  if (!candidates) return []

  const seen = new Set()
  const tokens = []
  for (const word of candidates) {
    const lower = word.toLowerCase()
    if (STOPWORDS.has(lower)) continue
    // Skip single-char or very short tokens
    if (lower.length < 2) continue
    // Skip words that look like numbers or superscripts
    if (/^\d/.test(word)) continue
    if (seen.has(lower)) continue
    seen.add(lower)
    tokens.push(lower)
    if (tokens.length >= 8) break
  }

  return tokens
}

/**
 * Extract publication year from filename (preferred) or content text.
 * Matches 4-digit years in range 1900-2099.
 */
function extractYear(filename, firstPageText) {
  const yearRe = /\b(19|20)\d{2}\b/
  // Filenames use underscores as separators, so \b won't match around them.
  // Use a looser pattern that allows _ or start/end of string as boundaries.
  const filenameYearRe = /(?:^|[_\-\s.])((?:19|20)\d{2})(?:$|[_\-\s.])/

  // Check filename first (after stripping timestamp)
  if (filename) {
    const stripped = stripTimestamp(filename)
    const fnMatch = stripped.match(filenameYearRe)
    if (fnMatch) return fnMatch[1]
  }

  // Fall back to first-page content
  if (firstPageText) {
    const contentMatch = firstPageText.match(yearRe)
    if (contentMatch) return contentMatch[0]
  }

  return null
}

/**
 * Extract DOI from content text.
 * Pattern: 10.XXXX/... with trailing punctuation stripped.
 */
function extractDoi(contentText) {
  if (!contentText) return null
  const doiMatch = contentText.match(/10\.\d{4,}\/\S+/)
  if (!doiMatch) return null
  // Strip trailing punctuation that isn't part of the DOI
  return doiMatch[0].replace(/[.,;:)\]}>]+$/, '')
}

/**
 * Extract journal name tokens from first-page text.
 * Looks for "Journal of X" patterns, text near DOI/volume info,
 * and significant words from the header area.
 */
function extractJournalTokens(firstPageText, authorTokenSet) {
  if (!firstPageText) return []

  const tokens = []
  const seen = new Set()

  // Strategy 1: Look for "Journal of ..." pattern
  // Don't filter by authorTokenSet here — journal name words often overlap
  // with author-region tokens (e.g. "Neuroinflammation" in both contexts)
  const journalOfMatch = firstPageText.match(/Journal\s+of\s+([A-Za-zÀ-ÖØ-öø-ÿ\s]+)/i)
  if (journalOfMatch) {
    const words = journalOfMatch[0].split(/\s+/)
    for (const w of words) {
      const lower = w.toLowerCase()
      if (lower.length > 2 && !STOPWORDS.has(lower) && !seen.has(lower)) {
        seen.add(lower)
        tokens.push(lower)
      }
    }
  }

  // Strategy 2: Look for common journal abbreviation patterns in first few lines
  // e.g. "N Engl J Med", "Ann Neurol", "Lancet", "BMC Neurol"
  const headerLines = firstPageText.split('\n').slice(0, 10)
  for (const line of headerLines) {
    // Match lines that look like journal references
    // They often contain abbreviated words and journal identifiers
    const journalLineMatch = line.match(
      /\b(?:Ann|Br|BMC|Clin|Eur|Int|Nat|Rev|Lancet|JAMA|Neurol|Brain|Muscle|Nerve|Cancer|Thorac|Oncol|Respir|Med|Sci|Syst)\b/gi
    )
    if (journalLineMatch) {
      for (const w of journalLineMatch) {
        const lower = w.toLowerCase()
        if (lower.length > 2 && !authorTokenSet.has(lower) && !seen.has(lower)) {
          seen.add(lower)
          tokens.push(lower)
        }
      }
    }
  }

  return tokens.slice(0, 5)
}

/**
 * Extract title tokens from first-page text.
 * The title is typically the first substantial heading — often the longest
 * line or the first multi-word line after journal info. Titles may span
 * multiple consecutive lines.
 */
function extractTitleTokens(firstPageText) {
  if (!firstPageText) return []

  // Find text before section headers
  const headerMatch = firstPageText.match(SECTION_HEADERS_RE)
  const region = headerMatch
    ? firstPageText.slice(0, headerMatch.index)
    : firstPageText.slice(0, 1200)

  const lines = region.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  // Find the best title candidate: longest contiguous block of text lines
  // that aren't DOIs, dates, metadata, or very short fragments
  let bestBlock = ''
  let bestLen = 0
  let currentBlock = ''
  let currentLen = 0

  for (const line of lines.slice(0, 20)) {
    // Skip metadata lines
    if (/^10\.\d{4}/.test(line)) { currentBlock = ''; currentLen = 0; continue }
    if (/^(Received|Revised|Accepted|Published|DOI|http|©)/i.test(line)) { currentBlock = ''; currentLen = 0; continue }
    if (/^\d/.test(line) && line.length < 20) { currentBlock = ''; currentLen = 0; continue }
    // Skip very short lines (likely volume/issue info)
    if (line.length < 8) { currentBlock = ''; currentLen = 0; continue }

    currentBlock = currentBlock ? currentBlock + ' ' + line : line
    currentLen += line.length

    if (currentLen > bestLen) {
      bestLen = currentLen
      bestBlock = currentBlock
    }
  }

  if (!bestBlock) return []

  // Extract significant words (>3 chars, not stopwords)
  const words = bestBlock.split(/[\s–—\-,;:()]+/)
  const tokens = []
  const seen = new Set()
  for (const w of words) {
    // Strip non-alphabetic leading/trailing chars
    const cleaned = w.replace(/^[^a-zA-ZÀ-ÖØ-öø-ÿ]+|[^a-zA-ZÀ-ÖØ-öø-ÿ]+$/g, '')
    const lower = cleaned.toLowerCase()
    if (lower.length > 3 && !STOPWORDS.has(lower) && !seen.has(lower)) {
      seen.add(lower)
      tokens.push(lower)
      if (tokens.length >= 8) break
    }
  }

  return tokens
}

/**
 * Normalize a filename for fuzzy matching.
 * Strips timestamp prefix, extension, replaces separators with spaces, lowercases.
 */
function normalizeFilename(filename) {
  if (!filename) return null
  return stripTimestamp(filename)
    .replace(/\.[^.]+$/, '')       // strip extension
    .replace(/[_\-]+/g, ' ')      // separators to spaces
    .replace(/\s+/g, ' ')         // collapse whitespace
    .toLowerCase()
    .trim() || null
}

/**
 * Normalize a display alias for fuzzy matching.
 */
function normalizeAlias(displayAlias) {
  if (!displayAlias) return null
  return displayAlias.toLowerCase().trim() || null
}

/**
 * Extract structured citation metadata from a reference document.
 *
 * @param {string} filename - The stored filename (may include timestamp prefix)
 * @param {string} contentText - Full extracted text of the document
 * @param {string|Array|null} pageBoundaries - Page boundary data (JSON string or array)
 * @param {string|null} displayAlias - Human-readable display name
 * @returns {Object} Citation metadata object
 */
export function extractCitationMetadata(filename, contentText, pageBoundaries, displayAlias) {
  const firstPageText = getFirstPageText(contentText, pageBoundaries)

  const first_author = extractFirstAuthor(filename)
  const author_tokens = extractAuthorTokens(firstPageText)
  const year = extractYear(filename, firstPageText)
  const doi = extractDoi(contentText)

  // Build author set for journal token filtering
  const authorTokenSet = new Set(author_tokens)

  const journal_tokens = extractJournalTokens(firstPageText, authorTokenSet)
  const title_tokens = extractTitleTokens(firstPageText)
  const normalized_filename = normalizeFilename(filename)
  const normalized_alias = normalizeAlias(displayAlias)

  return {
    first_author,
    author_tokens,
    year,
    journal_tokens,
    doi,
    title_tokens,
    normalized_filename,
    normalized_alias
  }
}
