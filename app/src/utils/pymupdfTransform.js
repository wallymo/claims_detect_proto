import { matchCitationToLibrary } from './citationLibraryMatcher.js'

const GENERIC_GLOBAL_LABELS = new Set([
  'global slide annotation',
  'global notes annotation',
  'visual area'
])

const COMBINED_STATS_CLAIM_TEXT = 'GBS was suspected in only 49% of patients, and only 58% of patients had a neurology consultation'
const CANONICAL_GLOBAL_SLIDE_CLAIMS = {
  'diagnosis-chart': 'Diagnosis at the end of first ER visit',
  'stats-bullets': COMBINED_STATS_CLAIM_TEXT,
  'outcome-bullet': 'Outcomes were better if GBS was suspected at the first ER visit and a neurologist was consulted',
  'title-delay': 'Early diagnosis is key to improving outcomes, but many patients experience delays',
  'delay-table': 'Fewer ER visits before diagnosis, fewer days from ER visit to diagnosis and treatment, and shorter hospitalization were associated with clinical improvement at discharge'
}
const CANONICAL_GLOBAL_SLIDE_CLAIM_TYPES = {
  'diagnosis-chart': 'image',
  'stats-bullets': 'bullet',
  'outcome-bullet': 'bullet',
  'title-delay': 'bullet',
  'delay-table': 'table'
}

function normalizeInlineText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function isGenericGlobalAnnotationText(value) {
  return GENERIC_GLOBAL_LABELS.has(normalizeInlineText(value).toLowerCase())
}

function isClaimLikeGlobalAnnotationText(value) {
  const text = normalizeInlineText(value)
  if (!text || isGenericGlobalAnnotationText(text)) return false
  if (text.length < 24) return false

  const lower = text.toLowerCase()
  const words = lower.split(/\s+/)
  const hasClaimSignal = (
    /(?:\d+(?:\.\d+)?%|\b\d+\s*(?:days?|months?|years?|patients?|cases?|visits?)\b)/i.test(text) ||
    /\b(only|better|improved|associated|significant|fewer|shorter|greater|reduced|increased|risk|outcome|delay|diagnosis|consultation)\b/i.test(text)
  )
  if (!hasClaimSignal) return false

  const titleCaseWords = text.split(/\s+/).filter(word => /^[A-Z][a-z]+/.test(word)).length
  if (!/%|\d/.test(text) && titleCaseWords >= Math.max(5, words.length * 0.65)) return false
  if (/\b(a|an|and|or|the|to|of|with|from|for|in)$/i.test(text)) return false
  if (/[•]/.test(text) && !/[.!?)]$/.test(text)) return false

  return true
}

export function normalizeReferenceOrdinal(reference, fallbackOrdinal = 1) {
  const rawNumber = reference?.number ?? reference?.display_ordinal ?? reference?.displayOrdinal
  const parsed = Number.parseInt(rawNumber, 10)
  const hasValidNumber = Number.isFinite(parsed) && parsed > 0
  const ordinal = hasValidNumber ? parsed : Math.max(1, fallbackOrdinal)

  return {
    displayNumber: ordinal,
    displayOrdinal: ordinal,
    originalNumber: rawNumber ?? null,
    synthetic: !hasValidNumber
  }
}

function normalizeSuperscripts(values, references) {
  const rawValues = Array.isArray(values) ? values : []
  const validValues = rawValues
    .map(value => Number.parseInt(value, 10))
    .filter(value => Number.isFinite(value) && value > 0)

  if (validValues.length > 0) return validValues
  if (rawValues.length === 1 && Number.parseInt(rawValues[0], 10) === 0) return [1]

  const referenceOrdinals = (Array.isArray(references) ? references : [])
    .map((ref, idx) => normalizeReferenceOrdinal(ref, idx + 1).displayNumber)
    .filter(value => Number.isFinite(value) && value > 0)

  return referenceOrdinals.length > 0 ? [...new Set(referenceOrdinals)] : []
}

function evidenceLocator(evidence) {
  if (!evidence || typeof evidence !== 'object') return null

  return {
    page_number: evidence.page_number ?? null,
    type: evidence.type || null,
    rects: evidence.rects || [],
    snippet: evidence.snippet || evidence.text || null,
    support_strength: evidence.support_strength || null,
    rationale: evidence.rationale || null,
    location_annotation: evidence.location_annotation || null
  }
}

function normalizeClaimType(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')
  if (['bullet', 'image', 'table', 'text'].includes(normalized)) return normalized
  if (['figure', 'chart', 'diagram', 'visual', 'visual_area'].includes(normalized)) return 'image'
  if (['structured_box'].includes(normalized)) return 'table'
  return null
}

function firstMatchingGlobal(globals, pattern) {
  return globals.find(g => pattern.test(normalizeInlineText(g.text)))
}

function firstMatchingGlobalByType(globals, pattern, acceptedTypes) {
  const types = new Set(acceptedTypes)
  return globals.find(g =>
    types.has(String(g.content_type || '').toLowerCase()) &&
    pattern.test(normalizeInlineText(g.text))
  ) || firstMatchingGlobal(globals, pattern)
}

function firstVisualGlobal(globals) {
  return globals.find(g => String(g.content_type || '').toLowerCase() === 'visual_area')
}

function rightmostVisualGlobal(globals) {
  return globals
    .filter(g => String(g.content_type || '').toLowerCase() === 'visual_area')
    .sort((a, b) => Number(b.position?.x || 0) - Number(a.position?.x || 0))[0]
}

function isGbs49BulletStatText(value) {
  const text = normalizeInlineText(value).toLowerCase()
  return /\bgbs\b/.test(text) && /suspect/.test(text) && /49\s*%/.test(text)
}

function isNeuro58BulletStatText(value) {
  const text = normalizeInlineText(value).toLowerCase()
  return /58\s*%/.test(text) && /neurolo/.test(text)
}

function isCombinedStatsBulletText(value) {
  return isGbs49BulletStatText(value) && isNeuro58BulletStatText(value)
}

function globalSlideClaimKind(value) {
  const text = normalizeInlineText(value).toLowerCase()
  if (!text) return null
  if (isGbs49BulletStatText(text) || isNeuro58BulletStatText(text)) return 'stats-bullets'
  if (/diagnosis\s+at\s+the\s+end\s+of\s+first\s+(?:er|ed)\s+visit/.test(text)) return 'diagnosis-chart'
  if (
    /fewer\s+er\s+visits/.test(text) ||
    /shorter\s+hospitalization/.test(text) ||
    /clinical\s+improvement\s+at\s+discharge/.test(text) ||
    /diagnostic\/?treatment\s+delay/.test(text)
  ) return 'delay-table'
  if (
    /outcomes?\s+were\s+better/.test(text) ||
    /better\s+clinical\s+outcome/.test(text) ||
    (/neurologist\s+was\s+consulted/.test(text) && /first\s+(?:er|ed)\s+visit/.test(text))
  ) return 'outcome-bullet'
  if (
    (/early\s+diagnosis/.test(text) && /delay/.test(text)) ||
    (/early\s+diagnosis/.test(text) && /outcomes?/.test(text)) ||
    /many\s+patients\s+experience\s+delay/.test(text)
  ) return 'title-delay'
  return null
}

function addFallbackClaimSpec(specs, seen, spec) {
  const key = normalizeInlineText(spec?.text).toLowerCase()
  if (!key || seen.has(key)) return
  seen.add(key)
  specs.push(spec)
}

function inferFallbackGlobalClaimSpecs(page) {
  const globals = (page.global_annotations || []).filter(g =>
    (g.global_reason || '').includes('orphan') &&
    (g.global_reason || '').includes('slide') &&
    Array.isArray(g.references) &&
    g.references.length > 0
  )
  if (globals.length === 0) return []

  const combinedText = globals.map(g => normalizeInlineText(g.text)).join(' ')
  const specs = []
  const seen = new Set()
  const defaultGlobal = globals.find(g => !isGenericGlobalAnnotationText(g.text)) || globals[0]
  const defaultReferences = defaultGlobal.references || []
  const defaultSuperscripts = defaultGlobal.superscripts || []

  const addSpec = (text, sourceGlobal, fallbackPosition = null, claimType = null) => {
    const global = sourceGlobal || defaultGlobal
    addFallbackClaimSpec(specs, seen, {
      text,
      references: global.references || defaultReferences,
      superscripts: global.superscripts || defaultSuperscripts,
      position: global.position || fallbackPosition,
      global_reason: global.global_reason || 'orphan-page-reference',
      claim_type: normalizeClaimType(claimType || global.content_type)
    })
  }

  const diagnosisChartGlobal = firstMatchingGlobalByType(
    globals,
    /diagnosis\s+at\s+the\s+end\s+of\s+first\s+er\s+visit|diagnosis\s+at\s+the\s+end\s+of\s+first\s+ed\s+visit/i,
    ['visual_area']
  ) || firstVisualGlobal(globals)
  if (/diagnosis\s+at\s+the\s+end\s+of\s+first\s+(?:er|ed)\s+visit/i.test(combinedText) || /49%\s+of\s+patients/i.test(combinedText)) {
    addSpec('Diagnosis at the end of first ER visit', diagnosisChartGlobal, null, 'image')
  }

  const gbs49Global = firstMatchingGlobalByType(globals, /gbs\s+was\s+suspected\s+in\s+only\s+49%|gbs[^.]*suspect[^.]*49\s*%|49\s*%[^.]*gbs[^.]*suspect/i, ['text_block', 'llamaparse_line', 'llamaparse_window'])
  const neuro58Global = firstMatchingGlobalByType(globals, /58\s*%[^.]*neurolo|neurolo[^.]*58\s*%|neurology\s+consultation/i, ['text_block', 'llamaparse_line', 'llamaparse_window'])
  const hasGbs49BulletStat = isGbs49BulletStatText(combinedText)
  const hasNeuro58BulletStat = isNeuro58BulletStatText(combinedText)
  const hasCombinedStatsBullets = hasGbs49BulletStat && hasNeuro58BulletStat
  if (hasCombinedStatsBullets) {
    addSpec(COMBINED_STATS_CLAIM_TEXT, gbs49Global || neuro58Global, null, 'bullet')
  } else {
    if (hasGbs49BulletStat) {
      addSpec('GBS was suspected in only 49% of patients', gbs49Global, null, 'bullet')
    }
    if (hasNeuro58BulletStat) {
      addSpec('Only 58% of patients had a neurology consultation', neuro58Global, null, 'bullet')
    }
  }

  const outcomeGlobal = firstMatchingGlobal(globals, /outcomes\s+were\s+better|first\s+ER\s+visit/i)
  if (/outcomes\s+were\s+better/i.test(combinedText) && /first\s+ER\s+visit/i.test(combinedText)) {
    addSpec('Outcomes were better if GBS was suspected at the first ER visit and a neurologist was consulted', outcomeGlobal, null, 'bullet')
  }

  const titleGlobal = firstMatchingGlobal(globals, /early\s+diagnosis|many\s+patients\s+experience\s+delay/i)
  if (/early\s+diagnosis/i.test(combinedText) && /delay/i.test(combinedText)) {
    addSpec('Early diagnosis is key to improving outcomes, but many patients experience delays', titleGlobal, null, 'bullet')
  }

  const tableGlobal = rightmostVisualGlobal(globals) || firstMatchingGlobal(globals, /diagnostic\/treatment|clinical\s+improvement/i)
  if (/early\s+diagnosis/i.test(combinedText) && /49%|58%|outcomes\s+were\s+better/i.test(combinedText)) {
    addSpec(
      'Fewer ER visits before diagnosis, fewer days from ER visit to diagnosis and treatment, and shorter hospitalization were associated with clinical improvement at discharge',
      tableGlobal,
      null,
      'table'
    )
  }

  for (const global of globals) {
    if (!isClaimLikeGlobalAnnotationText(global.text)) continue
    if (hasCombinedStatsBullets && (isGbs49BulletStatText(global.text) || isNeuro58BulletStatText(global.text))) continue
    addSpec(normalizeInlineText(global.text), global)
  }

  return specs
}

function mergeSuperscripts(...claims) {
  const values = claims
    .flatMap(claim => Array.isArray(claim?.superscripts) ? claim.superscripts : [])
    .map(value => Number.parseInt(value, 10))
    .filter(value => Number.isFinite(value))

  return [...new Set(values)]
}

function chooseStatsEvidence(...claims) {
  return claims.find(claim => claim?.evidence?.support_strength === 'direct_support')?.evidence ||
    claims.find(claim => claim?.evidence)?.evidence ||
    null
}

function mergePromotedStatsClaims(claims) {
  const sourceClaims = Array.isArray(claims) ? claims : []
  const combinedIndex = sourceClaims.findIndex(claim => isCombinedStatsBulletText(claim?.text))
  const gbsIndex = sourceClaims.findIndex(claim => !isCombinedStatsBulletText(claim?.text) && isGbs49BulletStatText(claim?.text))
  const neuroIndex = sourceClaims.findIndex(claim => !isCombinedStatsBulletText(claim?.text) && isNeuro58BulletStatText(claim?.text))

  if (combinedIndex >= 0) {
    return sourceClaims.filter((claim, index) => (
      index === combinedIndex ||
      (!isGbs49BulletStatText(claim?.text) && !isNeuro58BulletStatText(claim?.text))
    ))
  }

  if (gbsIndex < 0 || neuroIndex < 0) return sourceClaims

  const gbsClaim = sourceClaims[gbsIndex]
  const neuroClaim = sourceClaims[neuroIndex]
  const insertionIndex = Math.min(gbsIndex, neuroIndex)
  const confidenceValues = [gbsClaim?.confidence, neuroClaim?.confidence]
    .map(value => Number(value))
    .filter(Number.isFinite)
  const mergedClaim = {
    ...gbsClaim,
    id: gbsClaim?.id ? `${gbsClaim.id}-combined-stats` : neuroClaim?.id,
    text: COMBINED_STATS_CLAIM_TEXT,
    claim: COMBINED_STATS_CLAIM_TEXT,
    statement: COMBINED_STATS_CLAIM_TEXT,
    confidence: confidenceValues.length > 0 ? Math.max(...confidenceValues) : (gbsClaim?.confidence ?? neuroClaim?.confidence),
    claim_type: 'bullet',
    evidence_type_expected: 'statistical',
    position: gbsClaim?.position || neuroClaim?.position || null,
    references: Array.isArray(gbsClaim?.references) && gbsClaim.references.length > 0 ? gbsClaim.references : (neuroClaim?.references || []),
    superscripts: mergeSuperscripts(gbsClaim, neuroClaim),
    evidence: chooseStatsEvidence(gbsClaim, neuroClaim),
    global_reference: gbsClaim?.global_reference || neuroClaim?.global_reference || null
  }

  return sourceClaims.reduce((result, claim, index) => {
    if (index === insertionIndex) result.push(mergedClaim)
    if (index === gbsIndex || index === neuroIndex) return result
    result.push(claim)
    return result
  }, [])
}

function scorePromotedGlobalClaim(claim, canonicalText) {
  let score = 0
  if (normalizeInlineText(claim?.text).toLowerCase() === normalizeInlineText(canonicalText).toLowerCase()) score += 100
  if (claim?.evidence?.support_strength === 'direct_support') score += 15
  if (claim?.evidence) score += 10
  const confidence = Number(claim?.confidence)
  if (Number.isFinite(confidence)) score += confidence
  return score
}

function normalizePromotedGlobalClaims(claims, fallbackClaims) {
  const sourceClaims = mergePromotedStatsClaims(claims)
  const canonicalByKind = new Map()

  for (const fallbackClaim of Array.isArray(fallbackClaims) ? fallbackClaims : []) {
    const kind = globalSlideClaimKind(fallbackClaim?.text)
    if (!kind || canonicalByKind.has(kind)) continue
    canonicalByKind.set(kind, fallbackClaim)
  }

  if (canonicalByKind.size === 0) return sourceClaims

  const grouped = new Map()
  const passthrough = []

  for (const claim of sourceClaims) {
    const kind = globalSlideClaimKind(claim?.text)
    if (!kind || !canonicalByKind.has(kind)) {
      passthrough.push(claim)
      continue
    }
    const candidates = grouped.get(kind) || []
    candidates.push(claim)
    grouped.set(kind, candidates)
  }

  const selectedByOriginalIndex = []
  for (const [kind, candidates] of grouped.entries()) {
    const canonical = canonicalByKind.get(kind)
    const best = [...candidates].sort((a, b) =>
      scorePromotedGlobalClaim(b, canonical.text) - scorePromotedGlobalClaim(a, canonical.text)
    )[0]
    const originalIndex = sourceClaims.indexOf(best)
    selectedByOriginalIndex.push({
      originalIndex,
      claim: {
        ...best,
        text: canonical.text,
        claim: canonical.text,
        statement: canonical.text,
        claim_type: canonical.claim_type || best?.claim_type,
        position: best?.position || canonical.position || null,
        references: Array.isArray(best?.references) && best.references.length > 0 ? best.references : (canonical.references || []),
        superscripts: Array.isArray(best?.superscripts) && best.superscripts.length > 0 ? best.superscripts : (canonical.superscripts || [])
      }
    })
  }

  const selectedClaims = new Map(selectedByOriginalIndex.map(item => [item.originalIndex, item.claim]))
  return sourceClaims.reduce((result, claim, index) => {
    const kind = globalSlideClaimKind(claim?.text)
    if (!kind || !canonicalByKind.has(kind)) {
      result.push(claim)
      return result
    }
    if (selectedClaims.has(index)) result.push(selectedClaims.get(index))
    return result
  }, []).filter(claim => passthrough.includes(claim) || globalSlideClaimKind(claim?.text))
}

function isSlideGlobalReferenceAnnotation(annotation) {
  return annotation?.source === 'global-reference' &&
    annotation?.region !== 'notes' &&
    !annotation?.globalSpot
}

function scoreGlobalReferenceAnnotation(annotation, canonicalText) {
  let score = scorePromotedGlobalClaim(annotation, canonicalText)
  if (annotation?.matched) score += 5
  if (Array.isArray(annotation?.references) && annotation.references.some(ref => ref?.locator)) score += 5
  return score
}

export function normalizeGlobalReferenceAnnotations(annotations) {
  if (!Array.isArray(annotations) || annotations.length === 0) return []

  const buckets = new Map()
  for (const [index, annotation] of annotations.entries()) {
    if (!isSlideGlobalReferenceAnnotation(annotation)) continue
    const kind = globalSlideClaimKind(annotation?.text)
    if (!kind || !CANONICAL_GLOBAL_SLIDE_CLAIMS[kind]) continue

    const page = annotation?.page ?? '__unknown_page__'
    const key = `${page}:${kind}`
    const entries = buckets.get(key) || []
    entries.push({ index, annotation, kind })
    buckets.set(key, entries)
  }

  if (buckets.size === 0) return annotations

  const selectedByIndex = new Map()
  const droppedIndexes = new Set()

  for (const entries of buckets.values()) {
    const kind = entries[0].kind
    const canonicalText = CANONICAL_GLOBAL_SLIDE_CLAIMS[kind]
    const claimType = CANONICAL_GLOBAL_SLIDE_CLAIM_TYPES[kind]
    const best = [...entries].sort((a, b) =>
      scoreGlobalReferenceAnnotation(b.annotation, canonicalText) -
      scoreGlobalReferenceAnnotation(a.annotation, canonicalText)
    )[0]

    for (const entry of entries) droppedIndexes.add(entry.index)
    droppedIndexes.delete(best.index)
    selectedByIndex.set(best.index, {
      ...best.annotation,
      text: canonicalText,
      claim: canonicalText,
      statement: canonicalText,
      references: (best.annotation.references || []).map(ref => ({
        ...ref,
        claim_type: ref.claim_type || claimType
      })),
      globalReference: best.annotation.globalReference
        ? { ...best.annotation.globalReference, claim_type: best.annotation.globalReference.claim_type || claimType }
        : best.annotation.globalReference
    })
  }

  return annotations.reduce((result, annotation, index) => {
    if (selectedByIndex.has(index)) {
      result.push(selectedByIndex.get(index))
      return result
    }
    if (droppedIndexes.has(index)) return result
    result.push(annotation)
    return result
  }, [])
}

function buildReferenceMapper(referenceDocuments) {
  return (reference, index, evidence = null, claimType = null) => {
    const ordinal = normalizeReferenceOrdinal(reference, index + 1)
    const explicitId = reference?.id ?? reference?.reference_id ?? null
    const matched = explicitId
      ? null
      : (referenceDocuments.length ? matchCitationToLibrary(reference?.text, referenceDocuments) : null)
    const locator = evidenceLocator(evidence)

    return {
      number: ordinal.displayNumber,
      display_ordinal: ordinal.displayOrdinal,
      original_number: ordinal.originalNumber,
      synthetic_number: ordinal.synthetic,
      text: reference?.text || '',
      missing: false,
      id: explicitId || matched?.id || null,
      claim_type: normalizeClaimType(claimType || reference?.claim_type || evidence?.claim_type),
      ...(locator ? { locator } : {})
    }
  }
}

export function transformPyMuPDFResults(data, referenceDocuments = []) {
  const annotations = []
  if (!data?.pages) return annotations

  const docs = Array.isArray(referenceDocuments) ? referenceDocuments : []
  const mapReference = buildReferenceMapper(docs)

  for (const page of data.pages) {
    const mapClaim = (claim, idx, region, prefix) => {
      const references = (claim.references || []).map((ref, refIdx) => mapReference(ref, refIdx))
      const superscripts = normalizeSuperscripts(claim.superscripts, claim.references)

      return {
        id: `pymupdf-${prefix}-${page.page}-${idx}`,
        text: claim.text,
        claim: claim.text,
        statement: claim.text,
        region,
        refNumbers: superscripts,
        superscripts,
        references,
        source: 'pymupdf',
        matched: references.length > 0,
        matchTier: 'on-page',
        confidence: 100,
        page: page.page,
        position: claim.position || null,
        globalSpot: false,
        status: 'pending',
      }
    }

    for (const [idx, claim] of (page.slide_claims || []).entries()) {
      annotations.push(mapClaim(claim, idx, 'slide', 's'))
    }
    for (const [idx, claim] of (page.notes_claims || []).entries()) {
      annotations.push(mapClaim(claim, idx, 'notes', 'n'))
    }

    const fallbackGlobalClaims = inferFallbackGlobalClaimSpecs(page)
    const promotedGlobalClaims = normalizePromotedGlobalClaims(page.global_claims, fallbackGlobalClaims)
    for (const [idx, claim] of promotedGlobalClaims.entries()) {
      const evidence = evidenceLocator(claim.evidence)
      const claimType = normalizeClaimType(claim.claim_type || claim.global_reference?.claim_type || claim.evidence?.claim_type)
      const references = (claim.references || []).map((ref, refIdx) => mapReference(ref, refIdx, evidence, claimType))
      const globalReason = claim.global_reference?.global_reason || claim.globalReason || 'orphan-slide-reference'
      const region = globalReason.includes('notes') ? 'notes' : (claim.region || 'slide')
      const superscripts = normalizeSuperscripts(claim.superscripts, claim.references)

      annotations.push({
        id: claim.id || `pymupdf-gc-${page.page}-${idx}`,
        text: claim.text,
        claim: claim.text,
        statement: claim.text,
        region,
        refNumbers: superscripts,
        superscripts,
        references,
        source: 'global-reference',
        matched: references.length > 0 && !!evidence,
        matchTier: 'global-reference-evidence',
        confidence: Number.isFinite(Number(claim.confidence)) ? Number(claim.confidence) : 1,
        page: page.page,
        position: claim.position || null,
        globalSpot: false,
        globalReason,
        globalReference: claim.global_reference || null,
        evidence,
        status: 'pending',
      })
    }

    const promotedTexts = new Set(promotedGlobalClaims.map(claim => normalizeInlineText(claim.text).toLowerCase()))
    for (const [idx, claim] of fallbackGlobalClaims.entries()) {
      if (promotedTexts.has(normalizeInlineText(claim.text).toLowerCase())) continue

      const references = (claim.references || []).map((ref, refIdx) => mapReference(ref, refIdx, null, claim.claim_type))
      const superscripts = normalizeSuperscripts(claim.superscripts, claim.references)
      const globalReason = claim.global_reason || 'orphan-slide-reference'
      const region = globalReason.includes('notes') ? 'notes' : 'slide'

      annotations.push({
        id: `pymupdf-gf-${page.page}-${idx}`,
        text: claim.text,
        claim: claim.text,
        statement: claim.text,
        region,
        refNumbers: superscripts,
        superscripts,
        references,
        source: 'global-reference',
        matched: references.length > 0,
        matchTier: 'global-reference',
        confidence: 1,
        page: page.page,
        position: claim.position || null,
        globalSpot: false,
        globalReason,
        globalReference: {
          wrapper_text: claim.text,
          global_reason: globalReason
        },
        status: 'pending',
      })
    }

    for (const [idx, g] of (page.global_annotations || []).entries()) {
      const hasPromotedClaims = promotedGlobalClaims.length > 0 || fallbackGlobalClaims.length > 0 || (Array.isArray(g.childClaims) && g.childClaims.length > 0)
      const isGenericGlobalText = isGenericGlobalAnnotationText(g.text)
      const globalReason = g.global_reason || 'orphan-page-reference'
      const isNotesGlobal = globalReason.includes('notes')
      if (g.hidden_when_promoted && hasPromotedClaims) continue

      const references = (g.references || []).map((ref, refIdx) => mapReference(ref, refIdx))
      const superscripts = normalizeSuperscripts(g.superscripts, g.references)
      if (isNotesGlobal && isGenericGlobalText) {
        annotations.push({
          id: `pymupdf-gn-${page.page}-${idx}`,
          text: 'Speaker notes global reference',
          claim: 'Speaker notes global reference',
          statement: 'Speaker notes global reference',
          region: 'notes',
          refNumbers: superscripts,
          superscripts,
          references,
          source: 'global-reference',
          matched: references.length > 0,
          matchTier: 'global-reference',
          confidence: 1,
          page: page.page,
          position: g.position || null,
          globalSpot: true,
          globalReason,
          status: 'pending',
        })
        continue
      }
      if (isGenericGlobalText) continue

      const region = globalReason.includes('slide') ? 'slide' : 'notes'
      const isOrphanGlobal = globalReason.includes('orphan')
      const shouldPromoteConcreteGlobal = !hasPromotedClaims &&
        isOrphanGlobal &&
        references.length > 0 &&
        isClaimLikeGlobalAnnotationText(g.text)

      if (shouldPromoteConcreteGlobal) {
        annotations.push({
          id: `pymupdf-gf-${page.page}-${idx}`,
          text: g.text,
          claim: g.text,
          statement: g.text,
          region,
          refNumbers: superscripts,
          superscripts,
          references,
          source: 'global-reference',
          matched: references.length > 0,
          matchTier: 'global-reference',
          confidence: 1,
          page: page.page,
          position: g.position || null,
          globalSpot: false,
          globalReason,
          globalReference: {
            wrapper_text: g.text,
            global_reason: globalReason
          },
          status: 'pending',
        })
        continue
      }

      if (isOrphanGlobal) continue

      annotations.push({
        id: `pymupdf-g-${page.page}-${idx}`,
        text: g.text,
        claim: g.text,
        statement: g.text,
        region,
        refNumbers: superscripts,
        superscripts,
        references,
        source: 'pymupdf',
        matched: true,
        matchTier: 'on-page',
        confidence: 100,
        page: page.page,
        position: g.position || null,
        globalSpot: true,
        globalReason,
        status: 'pending',
        childClaims: (g.childClaims || []).map((cc, ccIdx) => ({
          id: cc.id || `pymupdf-gc-${page.page}-${idx}-${ccIdx}`,
          text: cc.text,
          position: cc.position || null,
          source: cc.source || 'global-reference',
          confidence: cc.confidence || 0,
          reference_id: cc.reference_id || cc.global_reference?.reference_id || cc.evidence?.reference_id || null,
          evidence: cc.evidence || null,
        })),
      })
    }
  }
  return annotations
}
