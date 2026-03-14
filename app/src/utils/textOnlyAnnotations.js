const GLOBAL_ANNOTATION_X = 94
const GLOBAL_BASE_Y = {
  slide: 10,
  notes: 18
}

function normalizeReferenceLookupKey(refNumber) {
  const raw = String(refNumber ?? '').trim()
  if (!raw) return ''
  return /^[a-e]$/i.test(raw) ? raw.toLowerCase() : raw
}

function lookupReferenceText(referencePool, refNumber) {
  if (!referencePool || typeof referencePool !== 'object') return ''

  const normalizedKey = normalizeReferenceLookupKey(refNumber)
  if (!normalizedKey) return ''

  if (Object.prototype.hasOwnProperty.call(referencePool, normalizedKey)) {
    return String(referencePool[normalizedKey] || '').trim()
  }

  const numericKey = Number.parseInt(normalizedKey, 10)
  if (Number.isFinite(numericKey) && numericKey > 0) {
    const stringKey = String(numericKey)
    if (Object.prototype.hasOwnProperty.call(referencePool, stringKey)) {
      return String(referencePool[stringKey] || '').trim()
    }
  }

  return ''
}

function inferTextOnlyContentType(candidate) {
  const text = String(candidate?.text || '').trim()
  const region = candidate?.region || 'slide'
  const pdfJsX = Number(candidate?.pdfJsX)
  const pdfJsY = Number(candidate?.pdfJsY)

  if (candidate?.globalSpot) return 'global'
  if (region === 'slide' && Number.isFinite(pdfJsY) && pdfJsY < 12) return 'title'
  if (/^[\s]*[•\-○▪–]/.test(text)) return 'bullet'
  if (Number.isFinite(pdfJsX) && pdfJsX > 10) return 'sub-bullet'
  if (region === 'slide' && Number.isFinite(pdfJsY) && pdfJsY > 35) return 'footnote'
  return 'bullet'
}

function compareCandidates(a, b) {
  const pageA = Math.max(1, Number.parseInt(a.page, 10) || 1)
  const pageB = Math.max(1, Number.parseInt(b.page, 10) || 1)
  if (pageA !== pageB) return pageA - pageB

  const regionOrder = { slide: 0, notes: 1 }
  const regionA = regionOrder[a.region] ?? 0
  const regionB = regionOrder[b.region] ?? 0
  if (regionA !== regionB) return regionA - regionB

  return (Number(a.pdfJsY) || 0) - (Number(b.pdfJsY) || 0)
}

function getPoolForRegion(textParsed, page, region) {
  if (region === 'notes') return textParsed.notesReferences?.[page] || {}
  return textParsed.slideFootnotes?.[page] || {}
}

function normalizeDisplayRefNumber(refNumber) {
  const raw = String(refNumber ?? '').trim()
  const parsed = Number.parseInt(raw, 10)
  if (Number.isFinite(parsed) && String(parsed) === raw) {
    return parsed
  }
  return refNumber
}

function getGlobalAnnotationFingerprint(referenceText, refNumber) {
  const normalized = String(referenceText || '')
    .replace(/^\s*(?:\d+|u\d+|[a-e]|[\u2020\u2021\u00a7*])[.:;)-]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  if (!normalized) return String(refNumber)

  const citationLike = /\bet al\b/.test(normalized) || /\b(19|20)\d{2}\b/.test(normalized)
  const firstAuthor = normalized.match(/^([a-z\u00c0-\u024f'-]+)/)?.[1]
  if (citationLike && firstAuthor) return `author:${firstAuthor}`

  return `text:${normalized}`
}

function createGlobalAnnotationText(region) {
  return region === 'notes' ? 'Global speaker notes annotation' : 'Global slide annotation'
}

function createAnnotationBinding({
  statement,
  refNumbers,
  references,
  region,
  page,
  position,
  globalSpot = false,
  globalReason = null
}) {
  return {
    statement,
    superscripts: [...(Array.isArray(refNumbers) ? refNumbers : [])],
    references: Array.isArray(references) ? references.map(ref => ({ ...ref })) : [],
    region,
    page,
    position: position ? { ...position } : null,
    globalSpot: Boolean(globalSpot),
    globalReason: globalReason || null
  }
}

function getOrCreateUsedSet(usedPoolKeysByRegion, page, region) {
  const mapKey = `${page}|${region}`
  if (!usedPoolKeysByRegion.has(mapKey)) {
    usedPoolKeysByRegion.set(mapKey, new Set())
  }
  return usedPoolKeysByRegion.get(mapKey)
}

function expandBracketedRangeRefs(refNumbers, referencePool, claimedRefCounts) {
  const original = Array.isArray(refNumbers) ? refNumbers : []
  const numericRefs = [...new Set(
    original
      .map(value => Number.parseInt(String(value ?? '').trim(), 10))
      .filter(Number.isFinite)
      .filter(value => String(value) === String(Number.parseInt(String(value), 10)))
  )].sort((a, b) => a - b)

  if (numericRefs.length !== 2) return original

  const [start, end] = numericRefs
  if (end - start < 5) return original

  const expandable = []
  for (let value = start + 1; value < end; value += 1) {
    const key = String(value)
    if (!Object.prototype.hasOwnProperty.call(referencePool || {}, key)) return original
    if ((claimedRefCounts.get(key) || 0) > 0) continue
    expandable.push(value)
  }

  if (expandable.length < 4) return original

  return [...new Set([...numericRefs, ...expandable])].sort((a, b) => a - b)
}

export function buildTextOnlyAnnotations(textParsed) {
  const pageNumbers = new Set()
  for (const candidate of Array.isArray(textParsed?.candidates) ? textParsed.candidates : []) {
    pageNumbers.add(Math.max(1, Number.parseInt(candidate.page, 10) || 1))
  }
  for (const page of Object.keys(textParsed?.slideFootnotes || {})) {
    pageNumbers.add(Math.max(1, Number.parseInt(page, 10) || 1))
  }
  for (const page of Object.keys(textParsed?.notesReferences || {})) {
    pageNumbers.add(Math.max(1, Number.parseInt(page, 10) || 1))
  }

  const directCandidates = (Array.isArray(textParsed?.candidates) ? textParsed.candidates : [])
    .filter(candidate => !candidate?.globalSpot)
    .sort(compareCandidates)

  const candidatesByPageRegion = new Map()
  for (const candidate of directCandidates) {
    const page = Math.max(1, Number.parseInt(candidate.page, 10) || 1)
    const region = candidate.region === 'notes' ? 'notes' : 'slide'
    const key = `${page}|${region}`
    if (!candidatesByPageRegion.has(key)) {
      candidatesByPageRegion.set(key, [])
    }
    candidatesByPageRegion.get(key).push(candidate)
  }

  const sortedPages = [...pageNumbers].sort((a, b) => a - b)
  const annotations = []
  const annotationBindings = []
  const usedPoolKeysByRegion = new Map()
  let annotationIndex = 0
  let globalAnnotationCount = 0

  for (const page of sortedPages) {
    for (const region of ['slide', 'notes']) {
      const directForRegion = candidatesByPageRegion.get(`${page}|${region}`) || []
      const referencePool = getPoolForRegion(textParsed, page, region)
      const usedPoolKeys = getOrCreateUsedSet(usedPoolKeysByRegion, page, region)
      const claimedRefCounts = new Map()

      for (const candidate of directForRegion) {
        const refNumbers = Array.isArray(candidate.refNumbers) ? candidate.refNumbers : []
        for (const refNumber of refNumbers) {
          const normalizedKey = normalizeReferenceLookupKey(refNumber)
          if (!normalizedKey) continue
          claimedRefCounts.set(normalizedKey, (claimedRefCounts.get(normalizedKey) || 0) + 1)
        }
      }

      for (const candidate of directForRegion) {
        const refNumbers = expandBracketedRangeRefs(
          Array.isArray(candidate.refNumbers) ? candidate.refNumbers : [],
          referencePool,
          claimedRefCounts
        )
        const references = refNumbers.map((refNumber) => {
          const text = lookupReferenceText(referencePool, refNumber)
          const normalizedKey = normalizeReferenceLookupKey(refNumber)
          if (text && normalizedKey) usedPoolKeys.add(normalizedKey)
          return {
            number: refNumber,
            text,
            missing: !text
          }
        })

        const globalSpot = references.some(ref => ref.missing)
        if (globalSpot) globalAnnotationCount += 1
        const statement = String(candidate.text || '').trim() || createGlobalAnnotationText(region)
        const position = globalSpot
          ? {
              x: GLOBAL_ANNOTATION_X,
              y: GLOBAL_BASE_Y[region]
            }
          : {
              x: Math.max(0, Math.min(100, Number(candidate.pdfJsX) || 5)),
              y: Math.max(0, Math.min(100, Number(candidate.pdfJsY) || 10)),
              ...(candidate.ocrSource ? { source: 'ocr' } : {})
            }
        const binding = createAnnotationBinding({
          statement,
          refNumbers,
          references,
          region,
          page,
          position,
          globalSpot,
          globalReason: globalSpot ? 'missing-page-reference' : null
        })

        annotationIndex += 1
        annotations.push({
          id: `ann-${annotationIndex}`,
          text: statement,
          claim: statement,
          statement,
          region,
          refNumbers,
          superscripts: [...refNumbers],
          references,
          source: 'on-page',
          matched: true,
          matchTier: 'on-page',
          contentType: globalSpot ? 'global' : inferTextOnlyContentType(candidate),
          confidence: 95,
          page,
          globalSpot,
          globalReason: globalSpot ? 'missing-page-reference' : null,
          position,
          annotationBinding: binding
        })
        annotationBindings.push(binding)
      }

      const orphanEntries = Object.entries(referencePool)
        .filter(([refNumber, refText]) => {
          const normalizedKey = normalizeReferenceLookupKey(refNumber)
          if (!normalizedKey || !String(refText || '').trim()) return false
          return !usedPoolKeys.has(normalizedKey)
        })

      if (orphanEntries.length === 0) continue

      const groupedOrphans = new Map()
      for (const [refNumber, refText] of orphanEntries) {
        const fingerprint = getGlobalAnnotationFingerprint(refText, refNumber)
        if (!groupedOrphans.has(fingerprint)) {
          groupedOrphans.set(fingerprint, [])
        }
        groupedOrphans.get(fingerprint).push({
          number: normalizeDisplayRefNumber(refNumber),
          text: String(refText || '').trim(),
          missing: false
        })
      }

      let groupIndex = 0
      for (const references of groupedOrphans.values()) {
        groupIndex += 1
        globalAnnotationCount += 1
        annotationIndex += 1
        const statement = createGlobalAnnotationText(region)
        const position = {
          x: GLOBAL_ANNOTATION_X,
          y: GLOBAL_BASE_Y[region] + ((groupIndex - 1) * 6)
        }
        const refNumbers = references.map(ref => ref.number)
        const binding = createAnnotationBinding({
          statement,
          refNumbers,
          references,
          region,
          page,
          position,
          globalSpot: true,
          globalReason: 'orphan-page-reference'
        })

        annotations.push({
          id: `ann-${annotationIndex}`,
          text: statement,
          claim: statement,
          statement,
          region,
          refNumbers,
          superscripts: [...refNumbers],
          references,
          source: 'on-page',
          matched: true,
          matchTier: 'on-page',
          contentType: 'global',
          confidence: 95,
          page,
          globalSpot: true,
          globalReason: 'orphan-page-reference',
          position,
          annotationBinding: binding
        })
        annotationBindings.push(binding)
      }
    }
  }

  return {
    annotations,
    annotationBindings,
    globalAnnotationCount
  }
}
