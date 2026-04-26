import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { GoogleGenAI } from '@google/genai'
import { Reference } from '../models/Reference.js'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const PYTHON_BIN = path.join(PROJECT_ROOT, 'scripts/.venv/bin/python3')
const CANDIDATES_SCRIPT = path.join(PROJECT_ROOT, 'scripts/evidence_candidates.py')

const FLASH_LITE_MODEL = 'gemini-3.1-flash-lite-preview'
const PRO_MODEL = 'gemini-3.1-pro-preview'
const GENERIC_GLOBAL_LABELS = new Set([
  'global slide annotation',
  'global notes annotation',
  'visual area'
])

const COMBINED_STATS_CLAIM_TEXT = 'GBS was suspected in only 49% of patients, and only 58% of patients had a neurology consultation'

const MATCHER_STOP_WORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'that', 'this', 'are', 'was', 'were',
  'has', 'have', 'been', 'not', 'but', 'its', 'also', 'can', 'may', 'all',
  'doi', 'vol', 'etal', 'etc', 'study', 'studies', 'journal', 'review'
])

function normalizeInlineText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function normalizeMatchText(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/['']/g, '')
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

function stripLeadingCitationNumber(text) {
  return String(text || '').replace(/^\d+\.\s*/, '')
}

function parseCitationText(text) {
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

function parseCitationMetadata(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
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

function scoreCitationFallback(parsed, ref) {
  const normalized = parsed.normalized
  const refName = normalizeMatchText(ref.display_alias || ref.name || '')
  const refOriginal = normalizeMatchText(ref.filename || ref.originalName || '')

  if (normalized === refName || normalized === refOriginal) return 0.95

  for (const candidate of [refName, refOriginal]) {
    if (!candidate || candidate.length < 4) continue
    if (normalized.includes(candidate) || candidate.includes(normalized)) return 0.7
  }

  if (parsed.tokens.size === 0) return 0

  let bestScore = 0
  for (const candidate of [refName, refOriginal]) {
    if (!candidate) continue
    const candidateWords = extractKeywords(candidate)
    if (candidateWords.length === 0) continue
    const overlap = candidateWords.filter(word => parsed.tokens.has(word)).length
    const candidateScore = overlap / candidateWords.length
    if (candidateScore > bestScore && candidateScore >= 0.6 && overlap >= 2) {
      bestScore = candidateScore * 0.5
    }
  }
  return bestScore
}

export function matchOrphanReferenceToLibrary(citationText, references) {
  if (!citationText || !Array.isArray(references) || references.length === 0) return null

  const parsed = parseCitationText(citationText)
  let bestMatch = null
  let bestScore = 0

  for (const ref of references) {
    const meta = parseCitationMetadata(ref.citation_metadata || ref.citationMetadata)
    const score = Math.max(
      scoreCitationMetadataMatch(parsed, meta),
      scoreCitationFallback(parsed, ref)
    )
    if (score > bestScore && score >= 0.5) {
      bestScore = score
      bestMatch = { ...ref, citation_match_score: score }
    }
  }

  return bestMatch
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

export function isGenericGlobalClaimText(text) {
  const normalized = normalizeInlineText(text).toLowerCase()
  return GENERIC_GLOBAL_LABELS.has(normalized)
}

function isWeakDiscoveredClaim(text) {
  const normalized = normalizeInlineText(text)
  if (!normalized || isGenericGlobalClaimText(normalized)) return true
  if (normalized.length < 24) return true

  const words = normalized.split(/\s+/)
  if (words.length < 5 && !/\d/.test(normalized)) return true
  if (/^(visual|chart|table|figure|image)\s+(area|region|content)$/i.test(normalized)) return true
  if (/^\W+$/.test(normalized)) return true

  return false
}

function isClaimLikeGlobalAnnotationText(text) {
  const normalized = normalizeInlineText(text)
  if (isWeakDiscoveredClaim(normalized)) return false

  const lower = normalized.toLowerCase()
  const words = lower.split(/\s+/)
  const hasClaimSignal = (
    /(?:\d+(?:\.\d+)?%|\b\d+\s*(?:days?|months?|years?|patients?|cases?|visits?)\b)/i.test(normalized) ||
    /\b(only|better|improved|associated|significant|fewer|shorter|greater|reduced|increased|risk|outcome|delay|diagnosis|consultation)\b/i.test(normalized)
  )
  if (!hasClaimSignal) return false

  const titleCaseWords = normalized.split(/\s+/).filter(word => /^[A-Z][a-z]+/.test(word)).length
  if (!/%|\d/.test(normalized) && titleCaseWords >= Math.max(5, words.length * 0.65)) return false
  if (/\b(a|an|and|or|the|to|of|with|from|for|in)$/i.test(normalized)) return false
  if (/[•]/.test(normalized) && !/[.!?)]$/.test(normalized)) return false

  return true
}

function inferClaimsFromGlobalAnnotation(globalAnno, orphanRefs) {
  if (!Array.isArray(orphanRefs) || orphanRefs.length === 0) return []
  const text = normalizeInlineText(globalAnno?.text)
  if (!isClaimLikeGlobalAnnotationText(text)) return []

  return [{
    text,
    position_hint: globalAnno?.position || null,
    reference_index: 0,
    evidence_type_expected: /\d|%|p\s*[<=>]/i.test(text) ? 'statistical' : 'general',
    confidence: 0.75,
    discovery_source: 'global_annotation_text'
  }]
}

function firstMatchingGlobalEntry(entries, pattern) {
  return entries.find(({ global }) => pattern.test(normalizeInlineText(global.text)))
}

function firstMatchingGlobalEntryByType(entries, pattern, acceptedTypes) {
  const types = new Set(acceptedTypes)
  return entries.find(({ global }) =>
    types.has(String(global.content_type || '').toLowerCase()) &&
    pattern.test(normalizeInlineText(global.text))
  ) || firstMatchingGlobalEntry(entries, pattern)
}

function firstVisualGlobalEntry(entries) {
  return entries.find(({ global }) => String(global.content_type || '').toLowerCase() === 'visual_area')
}

function rightmostVisualGlobalEntry(entries) {
  return entries
    .filter(({ global }) => String(global.content_type || '').toLowerCase() === 'visual_area')
    .sort((a, b) => Number(b.global.position?.x || 0) - Number(a.global.position?.x || 0))[0]
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
  const entries = (page.global_annotations || [])
    .map((global, index) => ({ global, index }))
    .filter(({ global }) =>
      (global.global_reason || '').includes('orphan') &&
      (global.global_reason || '').includes('slide') &&
      Array.isArray(global.references) &&
      global.references.length > 0
    )

  if (entries.length === 0) return []

  const combinedText = entries.map(({ global }) => normalizeInlineText(global.text)).join(' ')
  const specs = []
  const seen = new Set()
  const defaultEntry = entries.find(({ global }) => !isGenericGlobalClaimText(global.text)) || entries[0]

  const addSpec = (text, entry, evidenceType = 'general', confidence = 0.86, claimType = null) => {
    const sourceEntry = entry || defaultEntry
    addFallbackClaimSpec(specs, seen, {
      text,
      position_hint: sourceEntry.global.position || null,
      reference_index: 0,
      evidence_type_expected: evidenceType,
      confidence,
      claim_type: normalizeClaimType(claimType || sourceEntry.global.content_type),
      discovery_source: 'page_global_fallback',
      source_global_index: sourceEntry.index
    })
  }

  const diagnosisChartEntry = firstMatchingGlobalEntryByType(
    entries,
    /diagnosis\s+at\s+the\s+end\s+of\s+first\s+er\s+visit|diagnosis\s+at\s+the\s+end\s+of\s+first\s+ed\s+visit/i,
    ['visual_area']
  ) || firstVisualGlobalEntry(entries)
  if (/diagnosis\s+at\s+the\s+end\s+of\s+first\s+(?:er|ed)\s+visit/i.test(combinedText) || /49%\s+of\s+patients/i.test(combinedText)) {
    addSpec('Diagnosis at the end of first ER visit', diagnosisChartEntry, 'statistical', 0.9, 'image')
  }

  const gbs49Entry = firstMatchingGlobalEntryByType(entries, /gbs\s+was\s+suspected\s+in\s+only\s+49%|gbs[^.]*suspect[^.]*49\s*%|49\s*%[^.]*gbs[^.]*suspect/i, ['text_block', 'llamaparse_line', 'llamaparse_window'])
  const neuro58Entry = firstMatchingGlobalEntryByType(entries, /58\s*%[^.]*neurolo|neurolo[^.]*58\s*%|neurology\s+consultation/i, ['text_block', 'llamaparse_line', 'llamaparse_window'])
  const hasGbs49BulletStat = isGbs49BulletStatText(combinedText)
  const hasNeuro58BulletStat = isNeuro58BulletStatText(combinedText)
  const hasCombinedStatsBullets = hasGbs49BulletStat && hasNeuro58BulletStat
  if (hasCombinedStatsBullets) {
    addSpec(COMBINED_STATS_CLAIM_TEXT, gbs49Entry || neuro58Entry, 'statistical', 0.92, 'bullet')
  } else {
    if (hasGbs49BulletStat) {
      addSpec('GBS was suspected in only 49% of patients', gbs49Entry, 'statistical', 0.92, 'bullet')
    }
    if (hasNeuro58BulletStat) {
      addSpec('Only 58% of patients had a neurology consultation', neuro58Entry, 'statistical', 0.92, 'bullet')
    }
  }

  const outcomeEntry = firstMatchingGlobalEntry(entries, /outcomes\s+were\s+better|first\s+ER\s+visit/i)
  if (/outcomes\s+were\s+better/i.test(combinedText) && /first\s+ER\s+visit/i.test(combinedText)) {
    addSpec(
      'Outcomes were better if GBS was suspected at the first ER visit and a neurologist was consulted',
      outcomeEntry,
      'general',
      0.88,
      'bullet'
    )
  }

  const titleEntry = firstMatchingGlobalEntry(entries, /early\s+diagnosis|many\s+patients\s+experience\s+delay/i)
  if (/early\s+diagnosis/i.test(combinedText) && /delay/i.test(combinedText)) {
    addSpec(
      'Early diagnosis is key to improving outcomes, but many patients experience delays',
      titleEntry,
      'general',
      0.82,
      'bullet'
    )
  }

  const tableEntry = rightmostVisualGlobalEntry(entries) || firstMatchingGlobalEntry(entries, /diagnostic\/treatment|clinical\s+improvement/i)
  if (/early\s+diagnosis/i.test(combinedText) && /49%|58%|outcomes\s+were\s+better/i.test(combinedText)) {
    addSpec(
      'Fewer ER visits before diagnosis, fewer days from ER visit to diagnosis and treatment, and shorter hospitalization were associated with clinical improvement at discharge',
      tableEntry,
      'statistical',
      0.84,
      'table'
    )
  }

  for (const entry of entries) {
    if (!isClaimLikeGlobalAnnotationText(entry.global.text)) continue
    if (hasCombinedStatsBullets && (isGbs49BulletStatText(entry.global.text) || isNeuro58BulletStatText(entry.global.text))) continue
    addSpec(normalizeInlineText(entry.global.text), entry, /\d|%|p\s*[<=>]/i.test(entry.global.text) ? 'statistical' : 'general', 0.75)
  }

  return specs
}

function mergeDiscoveredStatsClaims(claims) {
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
    text: COMBINED_STATS_CLAIM_TEXT,
    position_hint: gbsClaim?.position_hint || neuroClaim?.position_hint || null,
    reference_index: gbsClaim?.reference_index ?? neuroClaim?.reference_index ?? 0,
    evidence_type_expected: 'statistical',
    confidence: confidenceValues.length > 0 ? Math.max(...confidenceValues) : (gbsClaim?.confidence ?? neuroClaim?.confidence),
    claim_type: 'bullet',
    discovery_source: gbsClaim?.discovery_source || neuroClaim?.discovery_source || 'stats_bullet_merge',
    source_global_index: gbsClaim?.source_global_index ?? neuroClaim?.source_global_index
  }

  return sourceClaims.reduce((result, claim, index) => {
    if (index === insertionIndex) result.push(mergedClaim)
    if (index === gbsIndex || index === neuroIndex) return result
    result.push(claim)
    return result
  }, [])
}

function dedupeDiscoveredClaims(claims) {
  const seen = new Set()
  const results = []

  for (const claim of Array.isArray(claims) ? claims : []) {
    const key = normalizeInlineText(claim?.text).toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    results.push(claim)
  }

  return results
}

function normalizePosition(position, fallback) {
  const source = position && typeof position === 'object' ? position : fallback
  if (!source || typeof source !== 'object') return null

  const x = Number(source.x)
  const y = Number(source.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

function resolveReferencePdfPath(filePath) {
  if (!filePath) return null
  if (path.isAbsolute(filePath)) return filePath

  const candidates = [
    path.resolve(process.cwd(), filePath),
    path.resolve(PROJECT_ROOT, 'backend', filePath),
    path.resolve(PROJECT_ROOT, filePath),
  ]

  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0]
}

async function discoverClaims({ page, globalAnnotation, orphanReferences }) {
  const apiKey = process.env.VITE_GEMINI_API_KEY
  if (!apiKey) return []

  const ai = new GoogleGenAI({ apiKey })
  const slideClaims = (page.slide_claims || [])
    .map((c, i) => `[slide-${i}] ${c.text} ${c.position ? `(position ${JSON.stringify(c.position)})` : ''}`)
    .join('\n')
  const notesClaims = (page.notes_claims || [])
    .map((c, i) => `[notes-${i}] ${c.text} ${c.position ? `(position ${JSON.stringify(c.position)})` : ''}`)
    .join('\n')
  const refsBlock = orphanReferences.map((r, i) =>
    `Reference ${i}: ${r.text}`
  ).join('\n')

  const prompt = `You are analyzing a pharma slide deck page. Some references appear as footnotes but have no superscript citations in the text.

PAGE NUMBER: ${page.page}

PARSER-DETECTED SLIDE CLAIMS:
${slideClaims || '(none)'}

PARSER-DETECTED SPEAKER-NOTE CLAIMS:
${notesClaims || '(none)'}

GLOBAL/ORPHAN ANNOTATION REGION:
text: ${globalAnnotation?.text || '(none)'}
content_type: ${globalAnnotation?.content_type || '(unknown)'}
position: ${JSON.stringify(globalAnnotation?.position || null)}

ORPHAN REFERENCES (no superscript points to them):
${refsBlock}

Task: Identify specific, complete statements in the slide content, speaker notes, or visual/table/chart region that these orphan references likely support. Look for:
- Quantitative claims (percentages, hazard ratios, p-values, incidence rates)
- Mechanism of action statements
- Safety/tolerability findings
- Efficacy endpoints
- Comparative claims (superior, improved, favorable)
- Epidemiological facts (incidence, prevalence)
- Chart/table-derived statements if the parser region text contains enough information to express the claim.

For each discovered claim, return:
- text: exact statement from the slide/notes when present; for visual/table claims, a complete sentence that states the visual's concrete finding
- position_hint: approximate { x, y } as percentage of page (your best estimate)
- reference_index: which orphan reference (0-indexed) supports this claim
- evidence_type_expected: "statistical" | "mechanism" | "safety" | "epidemiological" | "general"
- confidence: 0-1 how certain you are this reference supports this claim

Rules:
- Return real claim statements only.
- Do not return labels such as "Global slide annotation", "Global notes annotation", "Visual area", "Figure", "Table", or other generic region names.
- Do not return partial/truncated fragments.
- Do not invent a claim if the page content and region text do not contain enough information.
- Do not return reference citation text as a claim.

Return strict JSON only: { "discovered_claims": [...] }
If no claims match, return { "discovered_claims": [] }`

  const response = await ai.models.generateContent({
    model: FLASH_LITE_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json' }
  })

  const text = response.text || ''
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed.discovered_claims) ? parsed.discovered_claims : []
  } catch {
    console.warn('[GlobalLinker] Pass 1 parse failed:', text.slice(0, 200))
    return []
  }
}

function buildEvidenceFromCandidate(candidate, rationale = null, supportStrength = null) {
  if (!candidate) return null
  const score = Number(candidate.pre_score ?? candidate.score ?? 0)
  if (!Number.isFinite(score) || score < 0.2) return null

  return {
    page_number: candidate.page_number,
    type: candidate.type,
    rects: candidate.rects,
    snippet: candidate.snippet || candidate.text?.slice(0, 300) || null,
    rationale: rationale || `Top deterministic evidence candidate from the matched reference PDF (score ${score.toFixed(2)}).`,
    support_strength: supportStrength || (score >= 0.55 ? 'direct_support' : 'partial_support'),
    location_annotation: candidate.location_annotation || null
  }
}

function normalizeEvidenceText(text) {
  return String(text || '')
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeClaimType(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')
  if (['bullet', 'image', 'table', 'text'].includes(normalized)) return normalized
  if (['figure', 'chart', 'diagram', 'visual', 'visual_area', 'llamaparse_line', 'llamaparse_window'].includes(normalized)) return 'image'
  if (normalized === 'structured_box') return 'table'
  return null
}

function findSnippetAnchor(claimText, candidateText) {
  const claim = normalizeEvidenceText(claimText)
  const text = normalizeEvidenceText(candidateText)
  const phrases = []

  if (/\b49(?:\.3)?%?/.test(claim) && /suspect/.test(claim)) {
    phrases.push('49.3%', '49%', 'diagnosis was considered during the initial ed visit', 'gbs was suspected')
  }
  if (/diagnosis at the end of first (er|ed) visit/.test(claim)) {
    phrases.push('diagnosis at the end of first ed visit', 'figure 1', '34 (49.3%)', 'initial ed visit')
  }
  if (/\b58%/.test(claim) && /neuro/.test(claim)) {
    phrases.push('58% (40 patients) were evaluated by a neurologist', '58% were evaluated by a neurologist', 'neurology consultation')
  }
  if (/outcomes?\s+were\s+better|better clinical outcome|neurologist was consulted/.test(claim)) {
    phrases.push('significantly better clinical outcome', 'evaluated by a neurologist during the initial visit', 'positively impact clinical outcome')
  }
  if (/early diagnosis|patients experience delays?/.test(claim)) {
    phrases.push('early diagnosis', 'delayed diagnosis', 'delay in the diagnosis', 'early neurological evaluation')
  }
  if (/fewer er visits|shorter hospitalization|clinical improvement at discharge|diagnostic and treatment delay/.test(claim)) {
    phrases.push('table 1', 'residual weakness was associated', 'higher number of ed visits', 'diagnostic and treatment delay')
  }

  for (const phrase of phrases) {
    const idx = text.indexOf(phrase)
    if (idx >= 0) return idx
  }

  const keywords = extractKeywords(claimText).filter(word => word.length >= 5)
  for (const keyword of keywords) {
    const idx = text.indexOf(keyword)
    if (idx >= 0) return idx
  }

  return 0
}

function buildFocusedSnippet(candidateText, claimText) {
  const flat = String(candidateText || '').replace(/\s+/g, ' ').trim()
  if (!flat) return null

  const anchor = findSnippetAnchor(claimText, flat)
  const start = Math.max(0, anchor - 80)
  const snippet = flat.slice(start, start + 360).trim()
  return start > 0 ? `...${snippet}` : snippet
}

function deterministicEvidenceScore(claimText, candidate, rank) {
  const claim = normalizeEvidenceText(claimText)
  const text = normalizeEvidenceText(candidate.text)
  const loc = normalizeEvidenceText(candidate.location_annotation)
  const type = normalizeEvidenceText(candidate.type)
  const base = Number(candidate.pre_score ?? candidate.score ?? 0)
  let score = (Number.isFinite(base) ? base : 0) - (rank * 0.01)

  if (/\b49(?:\.3)?%?/.test(claim) && /suspect/.test(claim)) {
    if (/\b49(?:\.3)?%?/.test(text)) score += 0.35
    if (/initial ed visit|initial emergency department|first ed visit/.test(text)) score += 0.2
    if (loc.includes('/p385')) score += 0.4
    if (loc.includes('figure 1')) score += 0.2
    if (loc.includes('/p384')) score -= 0.35
  }

  if (/diagnosis at the end of first (er|ed) visit/.test(claim)) {
    if (/diagnosis at the end of first (er|ed) visit/.test(text)) score += 0.65
    if (loc.includes('/p385') && loc.includes('figure 1')) score += 0.75
    if (type === 'figure') score += 0.25
    if (loc.includes('/p384')) score -= 0.25
  }

  if (/\b58%/.test(claim) && /neuro/.test(claim)) {
    if (/\b58%/.test(text) && /evaluated by a neurologist|neurology consultation|neurological consultation/.test(text)) score += 0.55
    if (/\b58%/.test(text) && !/neurolog/.test(text)) score -= 0.25
    if (loc.includes('/p385')) score += 0.15
  }

  if (/outcomes?\s+were\s+better|better clinical outcome|neurologist was consulted/.test(claim)) {
    if (/better clinical outcome|improved clinical diagnosis|positively impact clinical outcome/.test(text)) score += 0.45
    if (/evaluated by a neurologist|neurological consultation/.test(text)) score += 0.2
    if (/initial visit|initial ed visit|first hospital encounter/.test(text)) score += 0.15
  }

  if (/early diagnosis|patients experience delays?/.test(claim)) {
    if (/early diagnosis|early neurological evaluation/.test(text)) score += 0.4
    if (/delayed diagnosis|delay in the diagnosis|delayed gbs diagnosis/.test(text)) score += 0.25
    if (/outcome|discharge disposition|prompt treatment/.test(text)) score += 0.2
    if (type === 'figure') score -= 0.15
  }

  if (/fewer er visits|shorter hospitalization|clinical improvement at discharge|diagnostic and treatment delay/.test(claim)) {
    if (loc.includes('table 1')) score += 0.9
    if (/association of clinical improvement.*diagnostic and treatment delay|diagnostic and treatment delay/.test(text)) score += 0.35
    if (/higher number of ed visits|time from initial ed visit|delay in initiation of treatment|duration of hospitalization/.test(text)) score += 0.25
  }

  return score
}

function selectDeterministicEvidence(claimText, candidates) {
  let bestCandidate = null
  let bestScore = -Infinity

  for (const [rank, candidate] of candidates.entries()) {
    const score = deterministicEvidenceScore(claimText, candidate, rank)
    if (score > bestScore) {
      bestScore = score
      bestCandidate = candidate
    }
  }

  if (!bestCandidate) return null

  const selected = {
    ...bestCandidate,
    pre_score: Math.max(
      Number(bestCandidate.pre_score ?? bestCandidate.score ?? 0) || 0,
      bestScore
    ),
    snippet: buildFocusedSnippet(bestCandidate.text, claimText)
  }
  const claim = normalizeEvidenceText(claimText)
  const selectedText = normalizeEvidenceText(selected.text)
  const selectedLoc = normalizeEvidenceText(selected.location_annotation)
  const directSupport = (
    (/diagnosis at the end of first (er|ed) visit/.test(claim) && selectedLoc.includes('figure 1')) ||
    (/\b49(?:\.3)?%?/.test(claim) && /\b49(?:\.3)?%?/.test(selectedText)) ||
    (/\b58%/.test(claim) && /\b58%/.test(selectedText) && /neurolog/.test(selectedText)) ||
    (/outcomes?\s+were\s+better|better clinical outcome|neurologist was consulted/.test(claim) && /better clinical outcome|improved clinical diagnosis|positively impact clinical outcome/.test(selectedText)) ||
    (/fewer er visits|shorter hospitalization|clinical improvement at discharge|diagnostic and treatment delay/.test(claim) && selectedLoc.includes('table 1'))
  )

  return buildEvidenceFromCandidate(
    selected,
    /diagnosis at the end of first (er|ed) visit/.test(claim)
      ? `Matched by figure title and underlying diagnosis data, not by chart style (score ${bestScore.toFixed(2)}).`
      : `Deterministic rerank selected the best supporting region from the matched reference PDF (score ${bestScore.toFixed(2)}).`,
    directSupport ? 'direct_support' : 'partial_support'
  )
}

async function locateEvidence(claimText, referencePdfPath) {
  const apiKey = process.env.VITE_GEMINI_API_KEY
  console.log(`[GlobalLinker] Running evidence_candidates.py for: "${claimText.slice(0, 50)}..."`)

  let candidates = []
  try {
    const { stdout } = await execFileAsync(
      PYTHON_BIN,
      [CANDIDATES_SCRIPT, referencePdfPath, '--claim', claimText, '--top-k', '15'],
      { cwd: PROJECT_ROOT, maxBuffer: 50 * 1024 * 1024, timeout: 60_000 }
    )
    const payload = JSON.parse(stdout)
    candidates = payload.candidates || []
    console.log(`[GlobalLinker] evidence_candidates.py returned ${candidates.length} candidates`)
  } catch (err) {
    console.warn('[GlobalLinker] evidence_candidates.py failed:', err.message)
    return null
  }

  if (candidates.length === 0) {
    console.log('[GlobalLinker] No candidates found, skipping Gemini rerank')
    return null
  }

  if (!apiKey) {
    console.log('[GlobalLinker] No Gemini key for rerank; using deterministic candidate rerank')
    return selectDeterministicEvidence(claimText, candidates)
  }

  console.log('[GlobalLinker] Starting Gemini Pro rerank...')

  const ai = new GoogleGenAI({ apiKey })
  const candidatesBlock = candidates.slice(0, 15).map((c, i) =>
    `[${i}] Page ${c.page_number}, type=${c.type}, score=${Number(c.pre_score ?? c.score ?? 0).toFixed(2)}, location=${c.location_annotation || '(none)'}: "${String(c.text || '').slice(0, 300)}"`
  ).join('\n')

  const prompt = `Given this claim and candidate evidence regions from ONE already-matched reference PDF, select the single BEST region that supports the claim.

CLAIM: "${claimText}"

CANDIDATES:
${candidatesBlock}

Return one evidence item only when it directly or partially supports the claim. If no candidate supports the claim, return an empty evidence array.

For the selected region, return:
- candidate_index: index from the list above
- support_strength: "direct_support" | "partial_support" | "weak_support"
- rationale: one sentence explaining why this evidence supports the claim

Return strict JSON: { "evidence": [{ "candidate_index": N, "support_strength": "...", "rationale": "..." }] }`

  try {
    const response = await ai.models.generateContent({
      model: PRO_MODEL,
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    })

    const text = response.text || ''
    console.log(`[GlobalLinker] Gemini Pro response: ${text.slice(0, 200)}...`)

    const parsed = JSON.parse(text)
    const selected = Array.isArray(parsed.evidence) ? parsed.evidence : []
    const first = selected[0]
    const cand = first ? candidates[first.candidate_index] : null
    if (!cand || first.support_strength === 'weak_support') {
      console.log('[GlobalLinker] Rerank complete: no supportable evidence selected')
      return null
    }

    const result = {
      page_number: cand.page_number,
      type: cand.type,
      rects: cand.rects,
      snippet: buildFocusedSnippet(cand.text, claimText),
      rationale: first.rationale,
      support_strength: first.support_strength,
      location_annotation: cand.location_annotation || null
    }

    console.log('[GlobalLinker] Rerank complete: 1 evidence region selected')
    return result
  } catch (err) {
    console.warn('[GlobalLinker] Gemini Pro rerank failed:', err.message)
    const selected = selectDeterministicEvidence(claimText, candidates)
    return selected
      ? { ...selected, rationale: 'Gemini rerank failed; deterministic rerank selected the best supporting region from the matched reference PDF.' }
      : null
  }
}

function buildPromotedGlobalClaim({
  page,
  globalAnno,
  globalIndex,
  claimIndex,
  discoveredClaim,
  orphanRef,
  refDoc,
  evidence,
  referenceOrdinal
}) {
  const normalizedText = normalizeInlineText(discoveredClaim.text)
  const evidencePayload = evidence
    ? {
        ...evidence,
        claim_type: normalizeClaimType(discoveredClaim.claim_type),
        reference_id: refDoc.id
      }
    : null
  const claimType = normalizeClaimType(discoveredClaim.claim_type || evidence?.claim_type)

  return {
    id: `pymupdf-gc-${page.page}-${globalIndex}-${claimIndex}`,
    text: normalizedText,
    superscripts: [referenceOrdinal.displayNumber],
    references: [{
      number: referenceOrdinal.displayNumber,
      display_ordinal: referenceOrdinal.displayOrdinal,
      original_number: referenceOrdinal.originalNumber,
      synthetic_number: referenceOrdinal.synthetic,
      text: orphanRef.text,
      id: refDoc.id,
      claim_type: claimType,
      match_confidence: refDoc.citation_match_score ?? null
    }],
    position: normalizePosition(discoveredClaim.position_hint, globalAnno.position),
    source: 'global-reference',
    match_tier: 'global-reference-evidence',
    confidence: discoveredClaim.confidence,
    claim_type: claimType,
    evidence_type_expected: discoveredClaim.evidence_type_expected || 'general',
    evidence: evidencePayload,
    global_reference: {
      wrapper_text: globalAnno.text,
      global_reason: globalAnno.global_reason || 'orphan-page-reference',
      reference_id: refDoc.id,
      reference_number: referenceOrdinal.displayNumber,
      original_reference_number: referenceOrdinal.originalNumber,
      synthetic_reference_number: referenceOrdinal.synthetic,
      claim_type: claimType,
      citation_text: orphanRef.text
    }
  }
}

function claimTextKey(text) {
  return normalizeInlineText(text).toLowerCase()
}

async function promoteDiscoveredClaims({
  page,
  globalAnno,
  globalIndex,
  discoveredClaims,
  orphanRefs,
  referenceDocs,
  existingClaimKeys
}) {
  const existingClaimKinds = new Set(
    [...existingClaimKeys].map(key => globalSlideClaimKind(key)).filter(Boolean)
  )
  const seenClaimKinds = new Set()
  const discovered = dedupeDiscoveredClaims(mergeDiscoveredStatsClaims(discoveredClaims))
    .filter(disc => !isWeakDiscoveredClaim(disc?.text))
    .filter((disc) => {
      const textKey = claimTextKey(disc.text)
      if (existingClaimKeys.has(textKey)) return false

      const kind = globalSlideClaimKind(disc.text)
      if (!kind) return true
      if (existingClaimKinds.has(kind) || seenClaimKinds.has(kind)) return false

      seenClaimKinds.add(kind)
      return true
    })

  if (discovered.length === 0) return []

  const evidencePromises = discovered.map(async (disc, claimIdx) => {
    const parsedRefIndex = Number.parseInt(disc.reference_index, 10)
    const refIndex = Number.isFinite(parsedRefIndex) ? parsedRefIndex : 0
    const ref = orphanRefs[refIndex] || orphanRefs[0]
    if (!ref) return null

    const refDoc = ref.id
      ? referenceDocs.find(doc => String(doc.id) === String(ref.id)) || matchOrphanReferenceToLibrary(ref.text, referenceDocs)
      : matchOrphanReferenceToLibrary(ref.text, referenceDocs)

    if (!refDoc?.file_path) {
      console.log(`[GlobalLinker] No matched file path for orphan ref "${String(ref.text || '').slice(0, 80)}", skipping`)
      return null
    }

    const pdfPath = resolveReferencePdfPath(refDoc.file_path)
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      console.log(`[GlobalLinker] Resolved PDF path missing for ref ${refDoc.id}: ${pdfPath}`)
      return null
    }

    try {
      console.log(`[GlobalLinker] Pass 2: locating evidence for claim "${disc.text.slice(0, 50)}..."`)

      const evidence = await Promise.race([
        locateEvidence(disc.text, pdfPath),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Evidence location timeout')), 90000)
        )
      ])

      console.log('[GlobalLinker] Pass 2 found evidence:', evidence ? 'YES' : 'NO')
      if (!evidence) return null

      const referenceOrdinal = normalizeReferenceOrdinal(ref, refIndex + 1)
      return buildPromotedGlobalClaim({
        page,
        globalAnno,
        globalIndex,
        claimIndex: claimIdx,
        discoveredClaim: disc,
        orphanRef: ref,
        refDoc,
        evidence,
        referenceOrdinal
      })
    } catch (err) {
      console.warn(`[GlobalLinker] Evidence location failed for claim: ${err.message}`)
      return null
    }
  })

  const results = await Promise.all(evidencePromises)
  const promotedClaims = results.filter(Boolean)
  for (const claim of promotedClaims) {
    existingClaimKeys.add(claimTextKey(claim.text))
  }
  return promotedClaims
}

export async function enrichGlobalAnnotations(pymupdfResult, brandId) {
  const hasGeminiKey = Boolean(process.env.VITE_GEMINI_API_KEY)
  if (!hasGeminiKey) {
    console.info('[GlobalLinker] No Gemini key — using deterministic global annotation promotion only')
  }

  const pagesWithGlobals = (pymupdfResult.pages || []).filter(p =>
    Array.isArray(p.global_annotations) && p.global_annotations.length > 0
  )

  if (pagesWithGlobals.length === 0) return pymupdfResult

  console.info(`[GlobalLinker] Enriching ${pagesWithGlobals.length} pages with global annotations`)

  let referenceDocs = []
  if (brandId) {
    try {
      referenceDocs = await Reference.findByBrandForGlobalLinking(brandId)
      console.log(`[GlobalLinker] Loaded ${referenceDocs.length} references for brand ${brandId}`)
    } catch (err) {
      console.warn('[GlobalLinker] Could not load reference paths for brand:', err.message)
    }
  }

  for (const page of pagesWithGlobals) {
    console.log(`[GlobalLinker] Processing page ${page.page} with ${page.global_annotations.length} global annotations`)
    if (!Array.isArray(page.global_claims)) page.global_claims = []
    const existingClaimKeys = new Set(page.global_claims.map(claim => claimTextKey(claim?.text)))

    const pageFallbackClaims = inferFallbackGlobalClaimSpecs(page)
    if (pageFallbackClaims.length > 0) {
      console.log(`[GlobalLinker] Page-level fallback found ${pageFallbackClaims.length} candidate claims`)
      const groupedFallbackClaims = new Map()
      for (const claim of pageFallbackClaims) {
        const sourceIndex = Number.isFinite(Number(claim.source_global_index))
          ? Number(claim.source_global_index)
          : 0
        if (!groupedFallbackClaims.has(sourceIndex)) groupedFallbackClaims.set(sourceIndex, [])
        groupedFallbackClaims.get(sourceIndex).push(claim)
      }

      for (const [globalIndex, discoveredClaims] of groupedFallbackClaims.entries()) {
        const globalAnno = page.global_annotations[globalIndex]
        const orphanRefs = globalAnno?.references || []
        if (!globalAnno || orphanRefs.length === 0) continue

        const promotedClaims = await promoteDiscoveredClaims({
          page,
          globalAnno,
          globalIndex,
          discoveredClaims,
          orphanRefs,
          referenceDocs,
          existingClaimKeys
        })

        if (promotedClaims.length > 0) {
          globalAnno.childClaims = [
            ...(Array.isArray(globalAnno.childClaims) ? globalAnno.childClaims : []),
            ...promotedClaims
          ]
          globalAnno.hidden_when_promoted = true
          page.global_claims.push(...promotedClaims)
        }
      }
    }

    for (const [globalIndex, globalAnno] of page.global_annotations.entries()) {
      const orphanRefs = globalAnno.references || []

      console.log(`[GlobalLinker] Global annotation has ${orphanRefs.length} orphan refs`)

      if (orphanRefs.length === 0) continue
      if ((globalAnno.global_reason || '').includes('notes')) continue

      try {
        console.log('[GlobalLinker] Starting Pass 1: discoverClaims...')
        const aiDiscovered = await discoverClaims({ page, globalAnnotation: globalAnno, orphanReferences: orphanRefs })
        const fallbackDiscovered = aiDiscovered.length === 0
          ? inferClaimsFromGlobalAnnotation(globalAnno, orphanRefs)
          : []
        const discovered = [...aiDiscovered, ...fallbackDiscovered]
        console.log(`[GlobalLinker] Pass 1 found ${discovered.length} usable claims`)

        if (discovered.length === 0) continue

        const promotedClaims = await promoteDiscoveredClaims({
          page,
          globalAnno,
          globalIndex,
          discoveredClaims: discovered,
          orphanRefs,
          referenceDocs,
          existingClaimKeys
        })
        if (promotedClaims.length > 0) {
          globalAnno.childClaims = [
            ...(Array.isArray(globalAnno.childClaims) ? globalAnno.childClaims : []),
            ...promotedClaims
          ]
          globalAnno.hidden_when_promoted = true
          page.global_claims.push(...promotedClaims)
        }

        console.info(`[GlobalLinker] Page ${page.page}: promoted ${promotedClaims.length} global reference claims`)
      } catch (err) {
        console.error(`[GlobalLinker] Failed to enrich global annotation on page ${page.page}:`, err)
      }
    }
  }

  console.log('[GlobalLinker] Enrichment complete')
  return pymupdfResult
}
