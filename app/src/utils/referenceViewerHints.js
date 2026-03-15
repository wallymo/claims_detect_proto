function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizePageBoundaries(pageBoundaries) {
  if (!pageBoundaries) return []

  let parsed = pageBoundaries
  if (typeof pageBoundaries === 'string') {
    try {
      parsed = JSON.parse(pageBoundaries)
    } catch {
      return []
    }
  }

  if (Array.isArray(parsed)) {
    return parsed
      .map((boundary, index) => ({
        ...boundary,
        page: Number.parseInt(boundary?.page, 10) || (index + 1)
      }))
      .sort((a, b) => (a.page || 0) - (b.page || 0))
  }

  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed)
      .map(([page, boundary]) => ({
        ...boundary,
        page: Number.parseInt(page, 10) || Number.parseInt(boundary?.page, 10) || 1
      }))
      .sort((a, b) => (a.page || 0) - (b.page || 0))
  }

  return []
}

function sliceReferencePages(contentText, pageBoundaries) {
  const text = String(contentText || '')
  const boundaries = normalizePageBoundaries(pageBoundaries)
  if (!text || boundaries.length === 0) return []

  return boundaries
    .map((boundary, index) => {
      const startChar = Number.isFinite(boundary?.startChar) ? boundary.startChar : boundary?.start
      const endChar = Number.isFinite(boundary?.endChar) ? boundary.endChar : boundary?.end
      if (!Number.isFinite(startChar) || !Number.isFinite(endChar) || endChar <= startChar) return null

      return {
        page: Number.parseInt(boundary?.page, 10) || (index + 1),
        text: text.slice(startChar, endChar)
      }
    })
    .filter(Boolean)
}

function splitPageLines(pageText) {
  return String(pageText || '')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
}

function scorePrintedPageMatch(pageText, targetPage) {
  const lines = splitPageLines(pageText)
  if (lines.length === 0) return 0

  const target = String(targetPage)
  const standaloneRe = new RegExp(`(?:^|\\D)${escapeRegExp(target)}(?:$|\\D)`)
  const explicitPageRe = new RegExp(`(?:^|\\b)(?:page|p\\.?)[\\s#:.-]*${escapeRegExp(target)}(?:\\b|$)`, 'i')
  const separatorWrappedRe = new RegExp(`(?:^|[|/·•-])\\s*${escapeRegExp(target)}\\s*(?:$|[|/·•-])`)
  let bestScore = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!standaloneRe.test(line)) continue

    const edgeDistance = Math.min(index, lines.length - 1 - index)
    let score = 1

    if (edgeDistance <= 1) score += 6
    else if (edgeDistance <= 3) score += 4
    else if (edgeDistance <= 5) score += 2

    if (line === target) {
      score += 9
    } else if (explicitPageRe.test(line)) {
      score += 8
    } else if (line.length <= target.length + 2) {
      score += 7
    } else if (line.length <= 20) {
      score += 4
    }

    if (separatorWrappedRe.test(line)) score += 2
    if (/\b(19|20)\d{2}\b/.test(line) && line.length > 24) score -= 2

    if (score > bestScore) bestScore = score
  }

  return bestScore
}

function expandEndPage(startPage, rawEndPage) {
  const start = Number.parseInt(startPage, 10)
  const rawEnd = String(rawEndPage || '').trim()
  const directEnd = Number.parseInt(rawEnd, 10)
  if (!Number.isFinite(start) || !Number.isFinite(directEnd)) return null
  if (rawEnd.length >= String(start).length || directEnd >= start) return directEnd

  const startDigits = String(start)
  const prefixLength = Math.max(0, startDigits.length - rawEnd.length)
  const prefix = startDigits.slice(0, prefixLength)
  let expanded = Number.parseInt(`${prefix}${rawEnd}`, 10)

  if (expanded < start && prefixLength > 0) {
    const bumpedPrefix = Number.parseInt(prefix, 10) + 1
    expanded = Number.parseInt(`${bumpedPrefix}${rawEnd}`, 10)
  }

  return expanded
}

export function parseCitationPageRange(citationText) {
  const source = String(citationText || '')
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!source) return null

  const rangePatterns = [
    /(?:pp?\.\s*)(\d{1,5})\s*[-–]\s*(\d{1,5})(?!\d)/i,
    /:\s*(\d{1,5})\s*[-–]\s*(\d{1,5})(?!\d)/,
    /(?:^|[,(;\s])(\d{1,5})\s*[-–]\s*(\d{1,5})(?!\d)(?:$|[).,;\s])/,
  ]

  for (const pattern of rangePatterns) {
    const match = source.match(pattern)
    if (!match) continue

    const start = Number.parseInt(match[1], 10)
    const end = expandEndPage(start, match[2])
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue

    return {
      start,
      end,
      label: `${start}-${end}`
    }
  }

  const singlePatterns = [
    /(?:pp?\.\s*)(\d{1,5})(?!\s*[-–]\s*\d)/i,
    /:\s*(\d{1,5})(?!\s*[-–]\s*\d)(?!\d)/,
  ]

  for (const pattern of singlePatterns) {
    const match = source.match(pattern)
    if (!match) continue

    const page = Number.parseInt(match[1], 10)
    if (!Number.isFinite(page)) continue

    return {
      start: page,
      end: page,
      label: String(page)
    }
  }

  return null
}

export function charOffsetToPage(charOffset, pageBoundaries) {
  const boundaries = normalizePageBoundaries(pageBoundaries)
  if (!Number.isFinite(charOffset) || boundaries.length === 0) return 1

  for (const boundary of boundaries) {
    const start = Number.isFinite(boundary?.startChar) ? boundary.startChar : boundary?.start
    const end = Number.isFinite(boundary?.endChar) ? boundary.endChar : boundary?.end
    if (Number.isFinite(start) && Number.isFinite(end) && charOffset >= start && charOffset <= end) {
      return Number.parseInt(boundary?.page, 10) || 1
    }
  }

  return Number.parseInt(boundaries[boundaries.length - 1]?.page, 10) || boundaries.length || 1
}

export function resolveCitationPdfPage({ citationText, contentText, pageBoundaries }) {
  const citationPages = parseCitationPageRange(citationText)
  if (!citationPages) return null

  const pages = sliceReferencePages(contentText, pageBoundaries)
  if (pages.length === 0) {
    return { ...citationPages, pdfPage: null, matchScore: 0 }
  }

  let bestMatch = null

  for (const page of pages) {
    const matchScore = scorePrintedPageMatch(page.text, citationPages.start)
    if (!bestMatch || matchScore > bestMatch.matchScore || (matchScore === bestMatch.matchScore && matchScore > 0 && page.page < bestMatch.pdfPage)) {
      bestMatch = {
        pdfPage: page.page,
        citationPageStart: citationPages.start,
        citationPageEnd: citationPages.end,
        citationPageLabel: citationPages.label,
        matchScore
      }
    }
  }

  if (!bestMatch || bestMatch.matchScore < 8) {
    return {
      citationPageStart: citationPages.start,
      citationPageEnd: citationPages.end,
      citationPageLabel: citationPages.label,
      pdfPage: null,
      matchScore: bestMatch?.matchScore || 0
    }
  }

  return bestMatch
}
