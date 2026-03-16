export const MAX_CITATION_REF_NUMBER = 50

function clampCitationRef(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_CITATION_REF_NUMBER) return null
  return parsed
}

function expandCitationRange(startRaw, endRaw) {
  const start = clampCitationRef(startRaw)
  const end = clampCitationRef(endRaw)
  if (!start || !end || end < start) return []
  if (end - start > 25) return [start]

  const refs = []
  for (let value = start; value <= end; value += 1) {
    refs.push(value)
  }
  return refs
}

export function parseNumericCitationRefs(text) {
  const source = String(text || '')
    .replace(/[\u2010-\u2015]/g, '-')
    .trim()

  if (!source) return []

  const refs = new Set()
  const segments = source.split(/[\u00b7·,;]/).map(segment => segment.trim()).filter(Boolean)

  for (const segment of segments) {
    const rangeMatch = segment.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/)
    if (rangeMatch) {
      expandCitationRange(rangeMatch[1], rangeMatch[2]).forEach(ref => refs.add(ref))
      continue
    }

    const single = clampCitationRef(segment)
    if (single) refs.add(single)
  }

  return [...refs].sort((a, b) => a - b)
}

export function extractTrailingCitationRefs(text) {
  const source = String(text || '').replace(/[\u2010-\u2015]/g, '-').trim()
  if (!source) return []

  const match = source.match(/(?:^|[\s(])(\d{1,2}(?:\s*-\s*\d{1,2}|(?:\s*,\s*\d{1,2})+))\s*(?:[*\u2020\u2021\u00a7\u00b6\u2016]+)?\s*$/)
  if (!match) return []

  return parseNumericCitationRefs(match[1])
}

const SUPER_MAP = {
  '\u2070': 0,
  '\u00b9': 1,
  '\u00b2': 2,
  '\u00b3': 3,
  '\u2074': 4,
  '\u2075': 5,
  '\u2076': 6,
  '\u2077': 7,
  '\u2078': 8,
  '\u2079': 9
}

const SUPER_CHARS = Object.keys(SUPER_MAP).join('')
export const SUPER_CHAR_PATTERN = SUPER_CHARS

const SUPER_PATTERN = new RegExp(`[${SUPER_CHARS}]+(?:[\\u00b7·,][${SUPER_CHARS}]+)*`, 'g')

/**
 * Extract citation refs fused into body text (no font-size separation).
 * Catches patterns like: "efficacy2", "outcomes1,2", "response1-3", "disease.2"
 * Avoids false positives from years (2024), percentages (47%), measurements (p<0.05)
 */
export function extractInlineFusedRefs(text) {
  const source = String(text || '').replace(/[\u2010-\u2015]/g, '-').trim()
  if (!source) return []

  const refs = new Set()

  // Pattern: word boundary or end-of-sentence followed by small numbers (1-50)
  // e.g., "efficacy2" "response1,2" "outcomes1-3" "disease.2,3"
  // Exclude: years (19xx, 20xx), percentages (47%), p-values, doses (mg), page numbers
  const inlinePattern = /(?<=[a-zA-Z).\]])(\d{1,2}(?:\s*[,\-]\s*\d{1,2})*)(?=[\s,;.)}\]:]|$)/g

  let match
  while ((match = inlinePattern.exec(source)) !== null) {
    const candidate = match[1]

    // Skip if it looks like a year
    if (/^(?:19|20)\d{2}$/.test(candidate)) continue
    // Skip if preceded by common non-ref contexts
    const preceding = source.substring(Math.max(0, match.index - 10), match.index)
    if (/(?:page|pp?|vol|no|n\s*=|p\s*[<=>&]|HR|CI|OR|\d+\.)\s*$/i.test(preceding)) continue
    // Skip if the number is > 50 (not a citation ref)
    const parsed = parseNumericCitationRefs(candidate)
    if (parsed.length > 0 && parsed.every(r => r <= MAX_CITATION_REF_NUMBER)) {
      parsed.forEach(r => refs.add(r))
    }
  }

  return [...refs].sort((a, b) => a - b)
}

export function parseSuperscriptCitationRefs(text) {
  const matches = String(text || '').match(SUPER_PATTERN)
  if (!matches) return []

  const refs = new Set()
  for (const match of matches) {
    const groups = match.split(/[\u00b7·,]/).filter(Boolean)
    for (const group of groups) {
      let numeric = ''
      for (const char of group) {
        if (SUPER_MAP[char] !== undefined) numeric += SUPER_MAP[char]
      }
      const ref = clampCitationRef(numeric)
      if (ref) refs.add(ref)
    }
  }

  return [...refs].sort((a, b) => a - b)
}
