/**
 * Gemini API Service - Single Source of Truth for all Gemini interactions
 *
 * This service handles:
 * - PDF document analysis and claim detection
 * - Reference matching between claims and knowledge base
 * - Text extraction from documents
 *
 * Uses models.generateContent() with inlineData for PDF processing.
 * NOTE: The newer interactions.create() API exists in docs but isn't yet
 * available in the stable @google/genai SDK (as of v1.33.0).
 */

import { GoogleGenAI } from '@google/genai'
import { logger } from '@/utils/logger'
import {
  dedupeClaimsByPageAndText,
  getClaimDedupOptions,
  normalizeDedupText,
  CLAIM_DEDUP_DEBUG_ENABLED
} from '@/utils/claimDedup'

// Singleton client instance
let geminiClient = null

// Initialize the Gemini client
const getGeminiClient = () => {
  if (geminiClient) return geminiClient

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('VITE_GEMINI_API_KEY is not set in .env.local')
  }
  geminiClient = new GoogleGenAI({ apiKey })
  return geminiClient
}

// Model configuration - SSOT for model selection
const GEMINI_MODEL_FROM_ENV = String(import.meta.env.VITE_GEMINI_MODEL || '').trim()
export const GEMINI_MODEL = GEMINI_MODEL_FROM_ENV || 'gemini-3-pro-preview'

// Friendly display names for models
export const MODEL_DISPLAY_NAMES = {
  'gemini-3-pro-preview': 'Gemini 3 Pro (Preview)',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'gemini-2.0-flash-exp': 'Gemini 2.0 Flash',
  'gemini-1.5-flash': 'Gemini 1.5 Flash',
  'gemini-1.5-pro': 'Gemini 1.5 Pro'
}

// Pricing per 1M tokens (USD) - approximate rates for Gemini Pro
// Update these based on current Google AI pricing
const PRICING = {
  'gemini-3-pro-preview': { input: 1.25, output: 5.00 },  // $/1M tokens
  'gemini-2.5-pro': { input: 1.25, output: 5.00 }, // keep in sync with current Google pricing
  'gemini-2.5-flash': { input: 0.075, output: 0.30 },
  'gemini-2.0-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'default': { input: 1.25, output: 5.00 }
}

const GEMINI_MODEL_FALLBACK_ORDER = [
  'gemini-3-pro-preview',
  'gemini-2.5-pro'
]

const resolvedGeminiModelCache = new Map()

function normalizeModelName(model) {
  return String(model || '').trim()
}

function getGeminiModelCandidates(preferredModel) {
  const preferred = normalizeModelName(preferredModel) || GEMINI_MODEL
  const cached = normalizeModelName(resolvedGeminiModelCache.get(preferred))
  const candidates = []
  const push = (model) => {
    const normalized = normalizeModelName(model)
    if (!normalized || candidates.includes(normalized)) return
    candidates.push(normalized)
  }

  if (cached) push(cached)
  push(preferred)

  const preferredIndex = GEMINI_MODEL_FALLBACK_ORDER.indexOf(preferred)
  if (preferredIndex >= 0) {
    GEMINI_MODEL_FALLBACK_ORDER.slice(preferredIndex + 1).forEach(push)
  } else {
    GEMINI_MODEL_FALLBACK_ORDER.forEach(push)
  }

  return candidates
}

function shouldRetryWithFallbackModel(error) {
  const message = String(error?.message || '').toLowerCase()
  return (
    message.includes('resource_exhausted') ||
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('service unavailable') ||
    message.includes('temporarily unavailable') ||
    message.includes('deadline exceeded') ||
    message.includes('internal') ||
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('unsupported model') ||
    message.includes('not found') ||
    message.includes('forbidden') ||
    message.includes('permission') ||
    message.includes('access')
  )
}

function shortErrorMessage(error) {
  const raw = String(error?.message || error || '')
  const compact = raw.replace(/\s+/g, ' ').trim()
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact
}

function summarizeSettledFailures(settledResults, prefix = 'pass') {
  const failures = []
  for (let i = 0; i < settledResults.length; i += 1) {
    const result = settledResults[i]
    if (!result || result.status !== 'rejected') continue
    failures.push(`${prefix}${i + 1}: ${shortErrorMessage(result.reason)}`)
  }
  if (failures.length === 0) return []
  return [...new Set(failures)]
}

function toUserFacingGeminiError(error) {
  const message = String(error?.message || error || '').replace(/\s+/g, ' ').trim()
  const lower = message.toLowerCase()

  if (
    lower.includes('"code":429') ||
    (lower.includes('429') && (lower.includes('quota') || lower.includes('rate limit')))
  ) {
    return 'Gemini API quota exceeded (429) for both primary and fallback models. Check Gemini billing/rate limits and retry.'
  }

  if (lower.includes('fetch failed') || lower.includes('network') || lower.includes('service unavailable')) {
    return 'Gemini API network/service error. Retry in a minute; if it persists, check network access and Gemini API status.'
  }

  return message || 'Gemini analysis failed'
}

async function generateContentWithModelFallback(client, { preferredModel, contents, config, purpose = 'request' }) {
  const preferred = normalizeModelName(preferredModel) || GEMINI_MODEL
  const candidates = getGeminiModelCandidates(preferred)
  let lastError = null

  for (let i = 0; i < candidates.length; i += 1) {
    const model = candidates[i]
    try {
      const response = await client.models.generateContent({
        model,
        contents,
        config
      })
      resolvedGeminiModelCache.set(preferred, model)
      if (model !== preferred) {
        logger.warn(`[Gemini] Using fallback model "${model}" for ${purpose} (preferred "${preferred}")`)
      }
      return { response, model }
    } catch (error) {
      lastError = error
      const hasNext = i < candidates.length - 1
      if (!hasNext || !shouldRetryWithFallbackModel(error)) {
        throw error
      }
      const nextModel = candidates[i + 1]
      logger.warn(
        `[Gemini] Model "${model}" failed for ${purpose}: ${shortErrorMessage(error)}. Trying "${nextModel}".`
      )
    }
  }

  throw lastError || new Error('No Gemini model could complete the request')
}

function parseBooleanEnvFlag(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

const GEMINI_VISUAL_SWEEP_ENABLED = parseBooleanEnvFlag(
  import.meta.env.VITE_GEMINI_VISUAL_SWEEP_ENABLED,
  true
)
const GEMINI_VISUAL_SWEEP_REQUIRED = parseBooleanEnvFlag(
  import.meta.env.VITE_GEMINI_VISUAL_SWEEP_REQUIRED,
  true
)

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const DETECTION_PASSES = Math.min(
  parsePositiveInt(import.meta.env.VITE_DETECTION_PASSES, 1),
  5  // Hard cap — more than 5 parallel calls is unreasonable
)
const GEMINI_VISUAL_SWEEP_TIMEOUT_MS = parsePositiveInt(
  import.meta.env.VITE_GEMINI_VISUAL_SWEEP_TIMEOUT_MS,
  90_000
)

function withTimeout(promise, timeoutMs, label = 'Operation') {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise

  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
// System instruction (moved out of user prompt for efficiency)
// Generic — doc-type-specific guidance is in the user prompt
const SYSTEM_INSTRUCTION = `You are a veteran MLR (Medical, Legal, Regulatory) reviewer for pharmaceutical promotional materials. Your mission: surface EVERY statement that could require substantiation. Flag 20 borderline phrases rather than let 1 slip through. When unsure, include it with lower confidence rather than omit.

Pay close attention to the DOCUMENT FORMAT section in the prompt — it tells you the layout of this specific document and how to scan it.`

// JSON Schema for strict output validation
const CLAIMS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      description: 'Array of detected claims requiring substantiation',
      items: {
        type: 'object',
        properties: {
          claim: {
            type: 'string',
            description: 'Exact phrase from document requiring substantiation'
          },
          confidence: {
            type: 'integer',
            description: 'Confidence score 0-100',
            minimum: 0,
            maximum: 100
          },
          page: {
            type: 'integer',
            description: 'Page number where claim appears',
            minimum: 1
          },
          x: {
            type: 'number',
            description: 'X position as % from left edge (0-100)',
            minimum: 0,
            maximum: 100
          },
          y: {
            type: 'number',
            description: 'Y position as % from top (0-100)',
            minimum: 0,
            maximum: 100
          }
        },
        required: ['claim', 'confidence', 'page', 'x', 'y']
      }
    }
  },
  required: ['claims']
}

/**
 * Calculate cost from token usage
 */
function calculateCost(model, inputTokens, outputTokens) {
  const pricing = PRICING[model] || PRICING['default']
  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  return inputCost + outputCost
}

/**
 * Parse model JSON output robustly.
 * Some responses still include markdown fences or extra text around JSON.
 */
function parseJsonResponse(rawText, contextLabel = 'Gemini response') {
  const text = typeof rawText === 'string' ? rawText.trim() : ''
  if (!text) {
    throw new Error(`${contextLabel} was empty`)
  }

  const candidates = []
  const seen = new Set()
  const pushCandidate = (value) => {
    const normalized = String(value || '').trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    candidates.push(normalized)
  }

  pushCandidate(text)

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) {
    pushCandidate(fencedMatch[1])
  }

  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  const hasObject = objectStart >= 0
  const hasArray = arrayStart >= 0

  if (hasObject || hasArray) {
    const start = hasObject && hasArray
      ? Math.min(objectStart, arrayStart)
      : hasObject ? objectStart : arrayStart
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
    if (start >= 0 && end > start) {
      pushCandidate(text.slice(start, end + 1))
    }
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // Try the next candidate variant.
    }
  }

  throw new Error(`Failed to parse ${contextLabel} as JSON`)
}

function extractUsageMetadata(response) {
  const usageMetadata = response?.usageMetadata || {}
  const inputTokens = usageMetadata.promptTokenCount || 0
  const outputTokens = usageMetadata.candidatesTokenCount || 0
  return { inputTokens, outputTokens }
}

function sanitizeRawClaim(rawClaim) {
  if (!rawClaim || typeof rawClaim !== 'object') return null

  const text = String(rawClaim.claim || '').replace(/\s+/g, ' ').trim()
  if (!text) return null

  const page = Math.max(1, Number.parseInt(rawClaim.page, 10) || 1)
  const confidenceRaw = Number(rawClaim.confidence)
  const confidence = Number.isFinite(confidenceRaw)
    ? clamp(Math.round(confidenceRaw), 0, 100)
    : 60

  const xRaw = Number(rawClaim.x)
  const yRaw = Number(rawClaim.y)
  const x = Number.isFinite(xRaw) ? clamp(xRaw, 0, 100) : 0
  const y = Number.isFinite(yRaw) ? clamp(yRaw, 0, 100) : 0

  return {
    claim: text,
    confidence,
    page,
    x,
    y
  }
}

function normalizeRawClaims(rawClaims) {
  if (!Array.isArray(rawClaims)) return []
  return rawClaims
    .map(sanitizeRawClaim)
    .filter(Boolean)
}

function dedupeRawClaims(rawClaims, options = {}, sourceLabel = 'raw') {
  const candidates = rawClaims.map((claim, index) => ({
    id: `raw_${sourceLabel}_${index + 1}`,
    text: claim.claim,
    page: claim.page,
    confidence: Number.isFinite(claim.confidence) ? claim.confidence / 100 : 0.6,
    position: { x: claim.x, y: claim.y },
    __raw: claim
  }))

  const deduped = dedupeClaimsByPageAndText(candidates, options)
  return {
    ...deduped,
    claims: deduped.claims.map(claim => claim.__raw)
  }
}

function mergeRawClaims(primaryClaims, visualClaims, dedupOptions) {
  // Merge primary union + visual sweep. Dedup key is page+text (no coordinates) —
  // same sentence on the same page/slide is always one claim regardless of where it sits.
  // Cross-page/slide repeats (e.g. slide vs appendix) are intentionally preserved.

  // For (0,0) visual claims: check if they're text echoes (same text as primary) or
  // genuine chart-derived claims. Echoes are dropped; chart claims get a right-margin
  // fallback position so they appear distinct from left-aligned text claims.
  const primaryTextKeys = new Set(
    primaryClaims.map(c => `${c.page}|${normalizeDedupText(c.claim)}`)
  )
  const CHART_FALLBACK_X = 85 // Right margin — opposite left-aligned text pins
  const CHART_FALLBACK_Y = 30 // Upper slide region where charts typically live

  let chartFallbackIndex = 0
  const validVisualClaims = visualClaims.filter(c => {
    if (c.x !== 0 || c.y !== 0) return true // Has real coordinates — keep
    // (0,0) claim: check if it's an echo of a primary claim
    const key = `${c.page}|${normalizeDedupText(c.claim)}`
    if (primaryTextKeys.has(key)) return false // Text echo — drop
    // Chart-derived claim without coords — assign right-margin fallback, distributed vertically
    c.x = CHART_FALLBACK_X
    c.y = Math.min(CHART_FALLBACK_Y + (chartFallbackIndex * 8), 50)
    c._chartFallbackPosition = true
    chartFallbackIndex++
    return true
  })

  const merged = [
    ...primaryClaims.map(claim => ({ ...claim, _source: 'primary' })),
    ...validVisualClaims.map(claim => ({ ...claim, _source: 'visual-sweep' }))
  ]
  const deduped = dedupeRawClaims(merged, dedupOptions, 'merged')

  if (CLAIM_DEDUP_DEBUG_ENABLED && Array.isArray(deduped.mergeEvents) && deduped.mergeEvents.length > 0) {
    logger.info({
      event: 'gemini_claim_dedup_debug',
      scope: 'merge_raw_claims',
      merge_events_count: deduped.mergeEvents.length,
      sample: deduped.mergeEvents.slice(0, 8)
    })
  }

  const visualNewUnique = Math.max(0, deduped.claims.length - primaryClaims.length)
  const visualDeduped = Math.max(0, validVisualClaims.length - visualNewUnique)
  const chartFallbackCount = validVisualClaims.filter(c => c._chartFallbackPosition).length

  return {
    claims: deduped.claims,
    stats: {
      visualFiltered: visualClaims.length - validVisualClaims.length,
      visualDeduped,
      visualNewUnique,
      chartFallbackPositioned: chartFallbackCount,
      duplicateCount: deduped.duplicateCount,
      exactDuplicateCount: deduped.exactDuplicateCount,
      nearDuplicateCount: deduped.nearDuplicateCount
    }
  }
}

function rawClaimsToFrontendClaims(rawClaims) {
  return rawClaims.map((claim, index) => ({
    id: `claim_${String(index + 1).padStart(3, '0')}`,
    text: claim.claim,
    confidence: claim.confidence / 100,
    status: 'pending',
    page: claim.page,
    position: { x: claim.x, y: claim.y }
  }))
}

function buildVisualSweepPrompt(docType) {
  const docLabel = docType || 'speaker-notes'
  const topRegionHint = docLabel === 'speaker-notes'
    ? '- For speaker-notes layouts, focus on the top slide region (y < 55) where charts and tables live.'
    : ''

  return `# Task
Run a SECOND PASS focused on claims embedded in GRAPHICAL elements — charts, graphs, tables, infographics, and diagrams. The first pass already captured text and speaker notes; this pass targets VISUAL DATA and the RELATIONSHIPS that charts communicate.

IMPORTANT: Do NOT repeat or paraphrase speaker notes or callout text. Focus exclusively on what the GRAPHIC ITSELF shows — the comparisons, trends, and data relationships visible in the visual elements.

# What to Extract — RELATIONSHIPS and DATA, not labels
Focus on what each graphic CLAIMS through its visual representation:

## Chart Types
- **Grouped/stacked bar charts**: What comparison is being shown? Which group is higher/lower? Extract the relationship (e.g., "GBS-DS 3-5 patients showed higher rates of poor outcomes than GBS-DS 0-2 across all time points").
- **Dot plots / strip plots / beeswarm plots**: What distribution pattern is visible? Are values elevated or clustered for certain groups? (e.g., "NfL levels were elevated across all GBS subtypes compared to healthy controls").
- **Box-and-whisker plots**: Median differences, spread, outliers between groups.
- **Bar/line/pie charts**: What outcome or trend does the chart show? Extract specific labeled values and what they measure.
- **Scatter plots**: Correlation direction, clustering, labeled data points.
- **Kaplan-Meier / survival curves**: Separation between curves, hazard ratios, median survival times.
- **Forest plots**: Point estimates, confidence intervals, overall effect sizes.
- **Tables**: EVERY data cell that states an outcome, rate, percentage, p-value, hazard ratio, odds ratio, or delta.
- **Waterfall / spider / swimmer plots**: Individual response rates, durations, thresholds.
- **Infographics with numbers**: Icons paired with statistics, pictographs, percentage wheels.

## Also Extract
- **Chart titles and axis labels** that frame a claim (e.g., "Factors Associated With Poor Outcomes" frames the entire chart as a claim).
- **Annotation markers (†, ‡, §, *)** on or near visual elements — both the annotated visual claim AND the footnote.
- **Legend categories** that imply a comparison (e.g., "Yes vs No", "Treatment vs Control").
- **Sample sizes (N=)** shown on axis labels or legends.
${topRegionHint}

## MOA / Pathway Diagrams
- **Mechanism of action diagrams**: What selectivity, binding, or inhibition is claimed? (e.g., "Drug X selectively inhibits JAK1 without affecting JAK3")
- **Receptor binding illustrations**: What receptor specificity or affinity is shown?
- **Cascade/signaling diagrams**: What downstream effects are being claimed? What pathways are activated or blocked?
- **Pharmacodynamic illustrations**: What biological process does the drug modulate?
- Any labeled mechanism step that implies therapeutic advantage is a claim.

## Flowcharts / Treatment Algorithms
- **Treatment sequencing diagrams**: What ordering or positioning is recommended? (e.g., "After failure of first-line therapy, switch to Drug X")
- **Patient selection criteria**: What eligibility, stratification, or biomarker criteria appear at decision nodes?
- **Clinical decision trees**: What outcomes or test results drive treatment decisions?
- **Recommended pathways**: Do they imply comparative advantage over alternatives?
- Each decision node containing a clinical criterion is a potential claim.

## Medical Illustrations / Anatomical Diagrams
- **Site-of-action diagrams**: What tissue penetration, organ targeting, or drug distribution is shown? These imply PK/PD claims.
- **Before/after comparisons**: Visual efficacy demonstrations (dermatology, ophthalmology, etc.) are claims requiring substantiation.
- **Timeline diagrams**: Onset of action, duration of response, or treatment milestones shown visually are temporal efficacy claims.
- **Drug distribution illustrations**: BBB crossing, tissue concentration, bioavailability shown visually = PK claims.

# Rules
- Describe what the chart SHOWS as a relationship or comparison — not just individual bar heights or dot positions.
- Extract only explicit values visible in the graphic. Do NOT estimate unlabeled bar heights or dot positions.
- Each distinct comparison, trend, or data point in a graphic is a separate claim.
- Deduplicate PER PAGE/SLIDE only (never across the full document).
- Do not invent values not visible in the graphic.
- If uncertain, include with lower confidence rather than omitting.
- Do NOT output claims that simply repeat speaker notes text verbatim.

# Output
Return ONLY JSON matching the required schema.`
}

/**
 * Convert a File object to base64 for Gemini API
 */
export async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // Remove the data URL prefix to get just the base64 string
      const base64 = reader.result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Leaner, markdown-structured prompts (role moved to systemInstruction)

// ===== Document-type-specific instructions =====
// These get prepended/appended to the user prompt based on selected document type.

const DOC_TYPE_INSTRUCTIONS = {
  'speaker-notes': {
    structure: `
# CRITICAL: TWO-REGION DOCUMENT STRUCTURE
⚠️ THIS DOCUMENT HAS TWO DISTINCT REGIONS PER PAGE - YOU MUST ANALYZE BOTH REGIONS AT THE MICRO LEVEL:

**REGION 1 - SLIDE IMAGE (top ~50% of page):**
Focus on TEXT-BASED elements in the slide:
- **Titles & subtitles** — headline claims, positioning statements
- **Body text** — sentences or phrases within the slide layout
- **Callout boxes & pull quotes** — highlighted statistics or key messages
- **Footnotes & small print** — disclaimers, study citations, asterisked qualifications at the bottom of the slide
- **Annotation markers (†, ‡, §, *)** — daggers, double daggers, and superscript symbols that link to footnotes containing study details, patient populations, p-values, statistical significance, or limitations. EACH annotation marker and its corresponding footnote text is a distinct substantiation point that must be flagged as a claim.
- **Watermarks & branded text** — sometimes contain claims like "Clinically Proven" or "FDA Approved"
- **Table/chart TITLES and labels** — extract the headline claim a table or chart makes (e.g., "Table 1: Efficacy Results"), but leave detailed cell-by-cell data extraction to the visual sweep pass

**REGION 2 - SPEAKER NOTES (bottom ~50% of page):**
Starts with header: "Speaker notes" or "Speaker note". Contains a NESTED bullet hierarchy — you must read ALL levels:
- **Main bullets (•)** — primary talking points, often contain headline claims
- **Sub-bullets (○ or ▪)** — supporting detail: specific statistics, study names, p-values, outcomes data
- **Sub-sub-bullets (– or -)** — additional granularity: subgroup data, secondary endpoints, safety specifics
- **Inline citations** — study references embedded in bullet text (e.g., "Smith et al., 2023") — the claim around the citation needs flagging
- **Parenthetical data** — numbers in parentheses like (p<0.001) or (95% CI: 1.2-3.4) are claims requiring substantiation
- **Annotation markers (†, ‡, §, *)** — dagger and double dagger symbols in text that reference footnotes with study limitations, populations, or statistical qualifiers. The annotated statement AND the footnote text are both claims.
- **Transitional statements** — phrases like "importantly," "notably," "uniquely" often precede substantive claims

🚨 FAILURE MODES TO AVOID:
1. Do NOT only read top-level (•) bullets — sub-bullets (○) and sub-sub-bullets contain the most specific claims
2. If your output has zero claims from speaker notes (y > 55%), you have FAILED the task
3. Do NOT skip slide footnotes and small print — these often contain critical substantiation points

`,
    position: `
# Position
- x: Position at the BULLET SYMBOL (• or ○) for bulleted text, NOT at the page margin
- y: vertical CENTER of claim as % (0=top, 100=bottom)
- Slide region elements:
  - Table claims: position at LEFT EDGE of the table cell containing the claim
  - Chart/graph claims: position at the data label or axis label, not the chart center
  - Footnote claims: position at the footnote text (typically y = 45-55%, near slide bottom)
  - Title claims: typically y = 2-10%
- Speaker notes region:
  - y will typically be 55-90% (bottom half of page)
  - Main bullets (•): x should be ~5-8%
  - Sub-bullets (○ or ▪): x should be ~8-12%
  - Sub-sub-bullets (– or -): x should be ~12-16%
  - IMPORTANT: Each nesting level is INDENTED further right

# EXTRACTION CHECKLIST
Before finalizing your response:
1. ☐ Did you check slide footnotes and small print?
2. ☐ Did you read ALL bullet levels in speaker notes — main (•), sub (○), and sub-sub (–)?
3. ☐ Did you flag parenthetical data like (p<0.001) and (95% CI: ...)?
4. ☐ Did you identify ALL annotation markers (†, ‡, §, *) and flag both the annotated statement AND corresponding footnote as claims?
5. ☐ Do you have claims with y > 55%? (If not, you missed speaker notes)`
  },

  'trifold': {
    structure: `
# DOCUMENT FORMAT: TRI-FOLD BROCHURE
This is a tri-fold (3-panel) pharmaceutical brochure. Each page has THREE distinct content panels arranged side-by-side.

**LAYOUT:**
- Page 1 (front): Three panels read left → center → right
- Page 2 (back): Three panels (may include cover panel, mailing panel, reference panel)

**WHERE TO FIND CLAIMS:**
- **Headlines & subheads** in each panel — often contain efficacy or benefit claims
- **Body copy** — detailed statements about mechanism, outcomes, safety
- **Callout boxes / pull quotes** — highlighted statistics or key messages
- **Charts, graphs, infographics** — visual statistical claims
- **Footnotes & references section** — may contain additional claims or qualifiers
- **Annotation markers (†, ‡, §, *)** — daggers and double daggers linking to study details, populations, p-values, or limitations. Each annotation is a substantiation point.
- **Bullet points** — listed benefits, features, or clinical data

🚨 FAILURE MODE TO AVOID: Do NOT only scan the largest or most prominent panel. ALL three panels on each page may contain substantive claims. Small-print body copy and footnotes are common locations for claims that need substantiation.

`,
    position: `
# Position
- x: Horizontal position as % from left edge (0-100). For a 3-panel layout:
  - Left panel claims: x typically 5-30%
  - Center panel claims: x typically 35-65%
  - Right panel claims: x typically 70-95%
- y: Vertical CENTER of claim as % from top (0-100)
- Charts/graphs: position at LEFT EDGE of the visual element
- Footnotes: position at actual text location (usually bottom of panel)

# EXTRACTION CHECKLIST
Before finalizing your response:
1. ☐ Did you scan ALL three panels on each page?
2. ☐ Did you check callout boxes and pull quotes?
3. ☐ Did you read footnotes and small-print body copy?
4. ☐ Did you extract claims from charts and infographics?
5. ☐ Did you identify all annotation markers (†, ‡, §, *) and flag annotated statements as claims?`
  },

  'slides-only': {
    structure: `
# DOCUMENT FORMAT: PRESENTATION SLIDES (NO SPEAKER NOTES)
This is a slide deck — each page is a single presentation slide. There are NO speaker notes below the slides.

**WHERE TO FIND CLAIMS:**
- **Slide titles & subtitles** — often contain primary efficacy or positioning claims
- **Bullet points** — listed benefits, clinical outcomes, safety data
- **Charts, graphs, tables** — visual data claims requiring substantiation
- **Callout boxes / highlighted text** — key statistics or messaging
- **Icons with text labels** — benefit statements paired with visual icons
- **Annotation markers (†, ‡, §, *)** — daggers and double daggers linking to footnotes with study details, populations, p-values, or limitations. Each is a substantiation point.
- **Bottom bars / footers** — may contain additional claims or references

🚨 FAILURE MODE TO AVOID: Do NOT assume slides contain fewer claims. Pharma slide decks pack claims into every element — titles, bullets, callouts, data visualizations. Analyze every visual and text element on each slide.

`,
    position: `
# Position
- x: Horizontal position as % from left edge (0-100)
- y: Vertical CENTER of claim as % from top (0-100)
- Title claims: typically y = 5-15%
- Bullet points: position at bullet symbol, NOT at margin
- Charts/graphs: position at LEFT EDGE of visual element
- Footer claims: typically y = 90-98%

# EXTRACTION CHECKLIST
Before finalizing your response:
1. ☐ Did you extract claims from slide titles and subtitles?
2. ☐ Did you check every bullet point on each slide?
3. ☐ Did you extract statistical claims from charts, graphs, and tables?
4. ☐ Did you check callout boxes and highlighted text?
5. ☐ Did you identify all annotation markers (†, ‡, §, *) and flag annotated statements as claims?`
  }
}

/**
 * Get document structure and position instructions for a given doc type.
 * Defaults to 'speaker-notes' for backward compatibility.
 * Exported so other AI services (anthropic, openai) can reuse the same instructions.
 */
export function getDocTypeInstructions(docType) {
  const instructions = DOC_TYPE_INSTRUCTIONS[docType] || DOC_TYPE_INSTRUCTIONS['speaker-notes']
  return { structure: instructions.structure, position: instructions.position }
}

/**
 * Detect whether a custom prompt already includes doc-type structure/position scaffolding.
 * This avoids injecting structure + position twice (which can dilute extraction focus).
 */
export function promptHasDocTypeScaffold(promptText) {
  const text = String(promptText || '')
  if (!text.trim()) return false

  const hasDocStructureHeading = /(^|\n)\s*#\s*(critical:\s*)?(two-region document structure|document format)\b/i.test(text)
  const hasPositionHeading = /(^|\n)\s*#\s*position\b/i.test(text)
  return hasDocStructureHeading && hasPositionHeading
}

export const OUTPUT_DEDUP_RULES = `
# Output Hygiene
- Deduplication scope is PER PAGE/SLIDE only.
- If the same claim text appears multiple times on the SAME page/slide, return only one instance.
- If the same claim appears on DIFFERENT pages/slides, keep one instance per page/slide.
- Do NOT dedupe across the full document.`

export const VISUAL_CLAIMS_INSTRUCTIONS = `
# Visual Element Claims
IMPORTANT: Charts, graphs, tables, diagrams, and illustrations contain claims that require substantiation just like text. Analyze EVERY visual element.

## Charts & Graphs
- Extract the RELATIONSHIP each chart shows (comparison, trend, superiority), not just axis labels
- Bar/line/pie/scatter charts, Kaplan-Meier curves, forest plots, waterfall/spider/swimmer plots
- Each distinct comparison or data point visible in a chart is a SEPARATE claim

## Tables
- EVERY data cell with an outcome, rate, percentage, p-value, hazard ratio, odds ratio, or delta is a claim
- Table titles framing a claim count as claims themselves

## MOA / Pathway Diagrams
- Mechanism of action diagrams showing selectivity, receptor binding, or pathway inhibition are claims
- "Selectively targets X receptor" shown visually = efficacy/specificity claim
- Cascade/signaling diagrams showing downstream effects = mechanism claims
- Any labeled step implying therapeutic advantage requires substantiation

## Flowcharts / Treatment Algorithms
- Treatment sequencing diagrams imply positioning claims (e.g., "use after first-line failure")
- Patient selection criteria at decision nodes = population claims
- Recommended pathways implying comparative advantage over alternatives

## Medical Illustrations
- Anatomical diagrams showing site-of-action, tissue penetration, or drug distribution = PK/PD claims
- Blood-brain barrier crossing, organ targeting = bioavailability claims
- Before/after visual comparisons = efficacy claims requiring substantiation

## Infographics & Pictographs
- Icon arrays showing proportions (e.g., 7/10 figures highlighted = "70% response rate")
- Timeline graphics showing onset of action or duration of response = temporal efficacy claims
- Percentage wheels, pictographs with statistics

## Visual Element Rules
- Chart titles and axis labels that frame a claim ARE claims
- Annotation markers (†, ‡, §, *) near visual elements must be flagged
- Extract only explicit values visible in the graphic — do NOT estimate unlabeled bar heights
- Each distinct comparison, trend, or data relationship = separate claim
- When uncertain about a visual element, include with lower confidence rather than omitting`

// User-facing prompt for All Claims (shown in UI, editable)
export const ALL_CLAIMS_PROMPT_USER = `# Task
Extract ALL claims requiring MLR substantiation from this pharmaceutical document.

# Claim Types
**Disease/Condition:** prevalence, burden, progression stats, unmet needs, risk factors
**Product/Treatment:** efficacy, safety, dosing, MOA, formulation advantages
**Comparative:** vs alternatives, trial citations, regulatory status, guidelines
**Patient Impact:** QOL improvements, outcomes, statistics

# Rules
- Each distinct data point, statistic, or substantiation-requiring statement is a SEPARATE claim
- If two statements need different references to substantiate them, they are separate claims
- Include charts/graphs/infographics with statistical claims
${VISUAL_CLAIMS_INSTRUCTIONS}
- Flag ALL annotation markers (†, ‡, §, *) — each dagger/double dagger references a footnote with study details, populations, or statistical qualifiers that require substantiation
- Complete, self-contained statements only
- Deduplicate PER PAGE/SLIDE only (never across the full document)

# Confidence (0-100)
90-100: Explicit stats, specific numbers | 70-89: Benefit promises, comparisons | 50-69: Borderline phrasing | 30-49: Weak promotional signal

# Examples
✅ CLAIM: "Patients on DRUG X achieved a 47% reduction in primary endpoint events vs. placebo (p<0.001)†"
→ confidence: 97, rationale: "Quantified comparative efficacy claim with statistical significance; † annotation links to study population requiring substantiation"

✅ CLAIM: "Superior to standard of care in reducing flare frequency"
→ confidence: 90, rationale: "'Superior' is a high-bar regulatory term; comparative efficacy claim requiring head-to-head trial data"

✅ CLAIM: "Well-tolerated with a favorable safety profile‡"
→ confidence: 85, rationale: "Safety characterization requiring substantiation; ‡ annotation links to AE data and study population qualifiers"

❌ NOT A CLAIM: "DRUG X is a JAK1/JAK2 inhibitor available as a 10 mg tablet."
→ Skip. Mechanism description + dosage form with no therapeutic outcome assertion.

Analyze now. Find everything requiring substantiation.`

// User-facing prompt for Disease State claims (shown in UI, editable)
export const DISEASE_STATE_PROMPT_USER = `# Task
Extract DISEASE STATE claims requiring MLR substantiation.

# Claim Types
- Prevalence, burden, progression statistics
- Unmet needs, treatment gaps
- Risk factors, symptoms, diagnostic criteria
- Epidemiological/population data
- Disease impact on QOL
- Natural history, disease trajectory
- Diagnostic challenges/delays
- Healthcare utilization, economic burden

# Rules
- Each distinct data point or substantiation-requiring statement is a SEPARATE claim
- If two statements need different references, they are separate claims
- Include visual elements with statistical claims
${VISUAL_CLAIMS_INSTRUCTIONS}
- Flag ALL annotation markers (†, ‡, §, *) — each links to substantiation-requiring footnote text
- Deduplicate PER PAGE/SLIDE only (never across the full document)

# Confidence (0-100)
90-100: Explicit stats, prevalence data | 70-89: Burden assertions, unmet needs | 50-69: Borderline | 30-49: Weak contextual

# Examples
✅ CLAIM: "Approximately 1 in 5 adults with psoriatic arthritis progress to severe joint damage within 5 years†"
→ confidence: 94, rationale: "Epidemiological progression statistic with specific rate requiring published population study; † links to study details"

✅ CLAIM: "Up to 40% of patients remain undiagnosed for more than 2 years after symptom onset"
→ confidence: 88, rationale: "Diagnostic delay burden statistic requiring epidemiological citation"

❌ NOT A CLAIM: "Psoriatic arthritis is a chronic immune-mediated inflammatory disease affecting joints and skin."
→ Skip. Established medical definition with no statistics or burden assertion requiring citation.

Analyze now. Find all disease/condition claims.`

// User-facing prompt for Medication claims (shown in UI, editable)
export const MEDICATION_PROMPT_USER = `# Task
Extract MEDICATION claims requiring MLR substantiation.

# Claim Types
- **Efficacy:** outcomes, onset, duration
- **Safety:** risk profile, side effects, interactions
- **Dosing:** schedule, convenience, administration
- **MOA:** biological/chemical mechanism
- **Formulation:** delivery advantages, dosing frequency
- **Comparative:** vs alternatives, standard of care
- **Authority:** trial citations, regulatory status
- **Patient:** QOL, lifestyle improvements
- **Annotations:** statements marked with †, ‡, §, * that link to footnotes with study details, populations, or qualifiers

# Rules
- Each distinct data point or substantiation-requiring statement is a SEPARATE claim
- If two statements need different references, they are separate claims
- Flag ALL annotation markers (†, ‡, §, *) — each dagger/double dagger is a distinct substantiation point
- Deduplicate PER PAGE/SLIDE only (never across the full document)
${VISUAL_CLAIMS_INSTRUCTIONS}

# Confidence (0-100)
90-100: "Clinically proven to reduce X" | 70-89: "Starts working in 3 days" | 50-69: "Helps patients feel better" | 30-49: "New era in treatment"

# Examples
✅ CLAIM: "DRUG X demonstrated sustained remission in 68% of patients at Week 52‡"
→ confidence: 96, rationale: "Long-term efficacy endpoint with specific percentage; ‡ indicates additional study qualifiers requiring substantiation"

✅ CLAIM: "Significantly fewer discontinuations due to adverse events vs. comparator (2.1% vs. 5.8%, p=0.03)"
→ confidence: 95, rationale: "Comparative safety claim with specific AE rates and p-value requiring clinical trial citation"

❌ NOT A CLAIM: "Take DRUG X once daily with or without food."
→ Skip. Standard dosing instruction from PI; no efficacy, safety, or comparative assertion.

Analyze now. Find all medication claims.`

/**
 * Analyze a PDF document and detect claims
 *
 * @param {File} pdfFile - The PDF file to analyze
 * @param {Function} onProgress - Optional progress callback
 * @param {string} promptKey - Prompt selection key ('all', 'drug', etc.)
 * @param {string|null} customPrompt - Optional custom prompt override
 * @param {Array|null} pageImages - Pre-rendered page images (unused by Gemini, kept for API compat)
 * @param {string} docType - Document type: 'speaker-notes', 'trifold', 'slides-only'
 * @returns {Promise<Object>} - Result with claims array
 */
function buildTrainingExamplesBlock(trainingExamples) {
  if (!Array.isArray(trainingExamples) || trainingExamples.length === 0) return ''
  const capped = trainingExamples.slice(0, 20)
  const lines = capped.map(c => `- "${c.text}" (${c.type || 'Claim'})`).join('\n')
  return `\n\nPRIOR APPROVED EXAMPLES (BRAND + ECOSYSTEM):\nThe following claims were previously reviewed and confirmed as valid examples:\n${lines}\n\nUse these as calibration examples. Detect claims of similar type, language pattern, and specificity.\n`
}

export async function analyzeDocument(pdfFile, onProgress, promptKey = 'all', customPrompt = null, _pageImages = null, docType = 'speaker-notes', factInventory = '', trainingExamples = [], { modelOverride } = {}) {
  const activeModel = modelOverride || GEMINI_MODEL
  const client = getGeminiClient()
  // Kept for API-compat with other providers; Gemini uses native PDF input.
  void _pageImages

  // Get doc-type-specific instructions
  const { structure, position } = getDocTypeInstructions(docType)

  // Build final prompt: custom prompt (if provided) or default.
  // If custom prompt already contains doc scaffolding, don't prepend/append it again.
  let userPrompt
  let customPromptHasScaffold = false
  if (customPrompt) {
    userPrompt = customPrompt
    customPromptHasScaffold = promptHasDocTypeScaffold(customPrompt)
    logger.debug(`Using custom prompt (${customPrompt.length} chars)`)
  } else {
    if (promptKey === 'drug') {
      userPrompt = MEDICATION_PROMPT_USER
    } else if (promptKey === 'disease') {
      userPrompt = DISEASE_STATE_PROMPT_USER
    } else {
      userPrompt = ALL_CLAIMS_PROMPT_USER
    }
    logger.info(`Using default prompt for: ${promptKey}`)
  }

  const promptBody = customPromptHasScaffold
    ? userPrompt
    : structure + userPrompt + position

  // Cache-bust: unique run ID prevents Gemini from serving cached responses for identical inputs.
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  // Extraction instructions first (strongest signal), supplemental context at end (matches pre-regression order).
  const trainingBlock = buildTrainingExamplesBlock(trainingExamples)
  const finalPrompt = `${promptBody}${trainingBlock}${factInventory || ''}

# Final Instruction
Extract all substantiation-requiring claims now and return ONLY JSON.
${OUTPUT_DEDUP_RULES}
<!-- run:${runId} -->`

  logger.info(
    `Final prompt: ${finalPrompt.length} chars, docType: ${docType}, custom_scaffold=${customPromptHasScaffold}`
  )

  onProgress?.(10, 'Analyzing document...')
  const base64Data = await fileToBase64(pdfFile)

  onProgress?.(25, 'Analyzing document...')

  try {
    let visualSweepPromise = null
    if (GEMINI_VISUAL_SWEEP_ENABLED) {
      const visualSweepPrompt = buildVisualSweepPrompt(docType)
      onProgress?.(30, 'Analyzing document...')
      visualSweepPromise = withTimeout(
        generateContentWithModelFallback(client, {
          preferredModel: activeModel,
          purpose: 'visual sweep',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: 'application/pdf',
                    data: base64Data
                  }
                },
                { text: visualSweepPrompt }
              ]
            }
          ],
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            temperature: 0,
            topP: 0.1,
            topK: 1,
            mediaResolution: 'MEDIA_RESOLUTION_HIGH',
            maxOutputTokens: 64000,
            responseMimeType: 'application/json',
            responseJsonSchema: CLAIMS_JSON_SCHEMA
          }
        }),
        GEMINI_VISUAL_SWEEP_TIMEOUT_MS,
        'Gemini visual sweep'
      )
    }

    // Fire all primary passes simultaneously — pick the one with the highest claim count.
    // Gemini is non-deterministic even at temperature 0; running passes in parallel and
    // selecting the richest result improves recall without adding sequential latency.
    const passPromises = Array.from({ length: DETECTION_PASSES }, (_, i) =>
      generateContentWithModelFallback(client, {
        preferredModel: activeModel,
        purpose: `claim detection pass ${i + 1}`,
        contents: [{ role: 'user', parts: [
          { inlineData: { mimeType: 'application/pdf', data: base64Data } },
          // Each pass gets a unique cache-bust suffix so Gemini treats them as independent requests
          { text: finalPrompt.replace(`<!-- run:${runId} -->`, `<!-- run:${runId}-p${i + 1} -->`) }
        ]}],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0, topP: 0.1, topK: 1,
          mediaResolution: 'MEDIA_RESOLUTION_HIGH',
          maxOutputTokens: 64000,
          responseMimeType: 'application/json',
          responseJsonSchema: CLAIMS_JSON_SCHEMA
        }
      }).then(({ response, model }) => ({ pass: i + 1, response, model }))
    )

    // allSettled: a single transient API failure doesn't abort the whole analysis
    const passSettled = await Promise.allSettled(passPromises)
    const passOutcomes = passSettled
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)

    const passFailures = summarizeSettledFailures(passSettled, 'pass ')
    if (passFailures.length > 0) {
      logger.warn({
        event: 'gemini_detection_pass_failures',
        failed_passes: passFailures.length,
        sample: passFailures.slice(0, 6)
      })
    }

    if (passOutcomes.length === 0) {
      const reason = passFailures.length > 0
        ? ` Reasons: ${passFailures.slice(0, 3).join(' | ')}`
        : ''
      throw new Error(`All detection passes failed — Gemini API may be unavailable.${reason}`)
    }
    const allPrimaryResponses = passOutcomes.map(o => o.response)

    // Union claims across all successful passes via shared dedup rules so
    // detection and UI-level collapse use the same behavior.
    const detectionDedupOptions = getClaimDedupOptions()
    let unionedPrimaryClaims = []
    const perPassCounts = []
    let parseFailures = 0

    for (const { pass, response } of passOutcomes) {
      let passClaims = []
      try {
        const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text
        const json = parseJsonResponse(text, `Gemini primary pass ${pass} response`)
        passClaims = normalizeRawClaims(json.claims)
      } catch (err) {
        parseFailures++
        logger.warn(`[Gemini] Pass ${pass} JSON parse failed, skipping: ${err.message}`)
      }

      const beforeUnique = unionedPrimaryClaims.length
      const deduped = dedupeRawClaims(
        [...unionedPrimaryClaims, ...passClaims],
        detectionDedupOptions,
        'primary-pass'
      )
      unionedPrimaryClaims = deduped.claims
      const newInPass = Math.max(0, unionedPrimaryClaims.length - beforeUnique)

      if (CLAIM_DEDUP_DEBUG_ENABLED && Array.isArray(deduped.mergeEvents) && deduped.mergeEvents.length > 0) {
        logger.info({
          event: 'gemini_claim_dedup_debug',
          scope: `primary_pass_${pass}`,
          merge_events_count: deduped.mergeEvents.length,
          sample: deduped.mergeEvents.slice(0, 6)
        })
      }

      perPassCounts.push({ pass, total: passClaims.length, newUnique: newInPass })
      logger.info(
        `[Gemini] Pass ${pass}/${DETECTION_PASSES}: ${passClaims.length} claims detected, ${newInPass} new unique, ${unionedPrimaryClaims.length} total union`
      )
    }

    if (parseFailures === passOutcomes.length) {
      throw new Error('All detection passes returned malformed JSON — Gemini response format may have changed')
    }

    logger.info(
      `[Gemini] ${passOutcomes.length}/${DETECTION_PASSES} passes succeeded (${parseFailures} parse errors). ` +
      `Union: ${unionedPrimaryClaims.length} claims after dedup.`
    )

    onProgress?.(72, 'Analyzing document...')

    let visualSweepResponse = null
    let visualClaims = []
    if (visualSweepPromise) {
      onProgress?.(78, 'Analyzing document...')
      try {
        const visualSweepCall = await visualSweepPromise

        visualSweepResponse = visualSweepCall.response
        const visualText = visualSweepResponse.candidates?.[0]?.content?.parts?.[0]?.text || visualSweepResponse.text
        const visualJson = parseJsonResponse(visualText, 'Gemini visual sweep response')
        visualClaims = normalizeRawClaims(visualJson.claims)
      } catch (visualSweepError) {
        if (GEMINI_VISUAL_SWEEP_REQUIRED) {
          throw new Error(`Visual sweep failed: ${visualSweepError.message}`)
        }
        logger.warn(`[Gemini] Visual sweep skipped: ${visualSweepError.message}`)
      }
    }

    onProgress?.(88, 'Analyzing document...')
    const merged = mergeRawClaims(unionedPrimaryClaims, visualClaims, detectionDedupOptions)
    const mergedRawClaims = merged.claims
    const claims = rawClaimsToFrontendClaims(mergedRawClaims)

    onProgress?.(95, 'Analyzing document...')

    // Aggregate usage across all passes
    let inputTokens = 0
    let outputTokens = 0
    for (const resp of allPrimaryResponses) {
      const usage = extractUsageMetadata(resp)
      inputTokens += usage.inputTokens
      outputTokens += usage.outputTokens
    }
    const visualUsage = extractUsageMetadata(visualSweepResponse)
    inputTokens += visualUsage.inputTokens
    outputTokens += visualUsage.outputTokens
    const resolvedModel = passOutcomes[0]?.model || activeModel
    const cost = calculateCost(resolvedModel, inputTokens, outputTokens)

    // Log for reproducibility tracking
    const modelVersion = allPrimaryResponses[0]?.modelVersion || resolvedModel
    const visualFiltered = merged.stats.visualFiltered
    const visualNewUnique = merged.stats.visualNewUnique
    const visualDeduped = merged.stats.visualDeduped
    const chartFallback = merged.stats.chartFallbackPositioned

    logger.info(
      `[Gemini] Model: ${modelVersion}, Claims: ${claims.length} (primary_union=${unionedPrimaryClaims.length}, visual_raw=${visualClaims.length}, visual_filtered_echo=${visualFiltered}, visual_deduped=${visualDeduped}, visual_new=${visualNewUnique}, chart_fallback=${chartFallback}, dedup_exact=${merged.stats.exactDuplicateCount}, dedup_near=${merged.stats.nearDuplicateCount}, passes=${DETECTION_PASSES}, visual_enabled=${GEMINI_VISUAL_SWEEP_ENABLED}), Tokens: ${inputTokens}/${outputTokens}, Cost: $${cost.toFixed(4)}`
    )

    // Store run diagnostics in window for console inspection
    const runDiagnostics = {
      runId,
      timestamp: new Date().toISOString(),
      totalClaims: claims.length,
      primaryUnion: unionedPrimaryClaims.length,
      perPassCounts,
      visual: {
        raw: visualClaims.length,
        filteredEchoes: visualFiltered,
        chartFallbackPositioned: chartFallback,
        deduped: visualDeduped,
        newUnique: visualNewUnique,
      },
      model: modelVersion,
      tokens: { input: inputTokens, output: outputTokens },
      cost,
    }
    if (typeof window !== 'undefined') {
      window.__claimsDiagnostics = window.__claimsDiagnostics || []
      window.__claimsDiagnostics.push(runDiagnostics)
    }

    const pricing = PRICING[modelVersion] || PRICING['default']
    return {
      success: true,
      claims,
      usage: {
        model: modelVersion,
        modelDisplayName: MODEL_DISPLAY_NAMES[modelVersion] || modelVersion,
        inputTokens,
        outputTokens,
        cost,
        inputRate: pricing.input,   // $/1M tokens
        outputRate: pricing.output  // $/1M tokens
      }
    }
  } catch (error) {
    logger.error('Gemini analysis error:', error)
    return {
      success: false,
      error: toUserFacingGeminiError(error),
      claims: [],
      usage: null
    }
  }
}

/**
 * Match a claim to potential references in the knowledge base
 *
 * @param {string} claimText - The claim text to match
 * @param {Array} references - Array of reference objects with name and content
 * @returns {Promise<Object>} - { result, usage }
 */
export async function matchClaimToReferences(claimText, references) {
  const client = getGeminiClient()

  const referenceList = references.map((ref, i) => {
    const scoreHints = []
    if (Number.isFinite(ref.hybridScore)) scoreHints.push(`hybrid ${(ref.hybridScore * 100).toFixed(0)}%`)
    if (Number.isFinite(ref.similarity)) scoreHints.push(`semantic ${(ref.similarity * 100).toFixed(0)}%`)
    if (Number.isFinite(ref.keywordOverlap)) scoreHints.push(`keyword ${(ref.keywordOverlap * 100).toFixed(0)}%`)
    if (Number.isFinite(ref.numericOverlap)) scoreHints.push(`numeric ${(ref.numericOverlap * 100).toFixed(0)}%`)

    const meta = []
    if (ref.page) meta.push(`Page: ${ref.page}`)
    if (scoreHints.length > 0) meta.push(`Ranking hints: ${scoreHints.join(', ')}`)

    return `[${i + 1}] ${ref.name}${meta.length ? `\n${meta.join('\n')}` : ''}\nContent excerpt: ${ref.excerpt || 'No excerpt available'}`
  }).join('\n\n')

  const prompt = `You are a pharmaceutical reference matcher for MLR (Medical, Legal, Regulatory) review.

Given this claim that needs substantiation:
"${claimText}"

And these available references from the knowledge base:
${referenceList}

Determine which reference (if any) best supports this claim.

Return JSON with this structure:
{
  "matched": true/false,
  "referenceIndex": 1-based index or null if no match,
  "referenceName": "name of matched reference" or null,
  "confidence": 0.0-1.0,
  "supportingExcerpt": "The specific text from the reference that supports this claim" or null,
  "pageInReference": "Page/section if known" or null,
  "reasoning": "Brief explanation of why this reference does or doesn't support the claim"
}

Rules:
- If "matched" is true, "referenceIndex" MUST be a valid index from the list above.
- Keep "referenceName" identical to the selected list entry name.
- Only match if the reference actually substantiates the claim. A low confidence match is better than a false positive.`

  try {
    const { response, model: matchingModel } = await generateContentWithModelFallback(client, {
      preferredModel: GEMINI_MODEL,
      purpose: 'reference matching',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      }
    })

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text
    const parsedResult = parseJsonResponse(text, 'Gemini reference matching response')
    const usage = extractUsageMetadata(response)
    const cost = calculateCost(matchingModel, usage.inputTokens, usage.outputTokens)

    return {
      result: parsedResult,
      usage: {
        model: matchingModel,
        modelDisplayName: MODEL_DISPLAY_NAMES[matchingModel] || matchingModel,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cost
      }
    }
  } catch (error) {
    logger.error('Reference matching error:', error)
    throw new Error(`Reference matching request failed: ${error.message}`)
  }
}

/**
 * Extract a verbatim supporting quote from a full reference document.
 * Used by Matching V2 Tier 2 — sends full reference text and asks AI to find exact quotes.
 *
 * @param {string} claimText - The claim needing substantiation
 * @param {string} referenceText - Full extracted text of the reference document
 * @param {string} referenceName - Display name of the reference
 * @returns {Promise<Object>} - { result: { supported, quotes, reasoning }, usage }
 */
export async function extractSupportingQuote(claimText, referenceText, referenceName) {
  const client = getGeminiClient()

  const prompt = `You are an MLR (Medical, Legal, Regulatory) reviewer checking whether a reference document contains content relevant to a specific claim. Your job is to help human reviewers find the right passages — err on the side of INCLUSION without fabricating evidence.

CLAIM: "${claimText}"

REFERENCE DOCUMENT (${referenceName}):
${referenceText}

TASK: Find the exact sentence(s), table cells, chart labels, or figure captions in this reference that support, partially support, or are directly relevant to this claim. Quote them VERBATIM — do not paraphrase, do not combine sentences, do not add words.

Return JSON:
{
  "supported": true or false,
  "quotes": [
    {
      "text": "exact verbatim quote copied from the reference above",
      "page_estimate": number or null,
      "evidence_type": "text_quote" | "table_cell" | "figure_caption" | "chart_label"
    }
  ],
  "reasoning": "1-2 sentence explanation of how the quote relates to the claim"
}

Rules:
- Return supported=true if the reference contains text that SUBSTANTIATES, PARTIALLY SUPPORTS, or is DIRECTLY RELEVANT to the claim. This includes:
  - Exact data that the claim cites or derives from
  - Source statistics from which the claim's numbers could be calculated or inferred
  - Related efficacy, safety, or endpoint data on the same topic
  - Context that a human reviewer would want to see alongside this claim
- Graphs and tables are valid evidence when their labels/cells/captions contain the relevant data point.
- Quotes must be VERBATIM text from the reference document above. Copy-paste, do not rephrase.
- Multiple quotes are allowed if multiple sentences together relate to the claim.
- Only return supported=false if the reference contains NO content relevant to the claim's topic.
- Use only evidence present in the provided extracted reference text. Do not OCR, do not invent missing numbers, and do not infer unlabeled chart values.`

  try {
    const { response, model: matchingModel } = await generateContentWithModelFallback(client, {
      preferredModel: GEMINI_MODEL,
      purpose: 'quote extraction',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json'
      }
    })

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text
    const parsedResult = parseJsonResponse(text, 'Gemini quote extraction response')
    const usage = extractUsageMetadata(response)
    const cost = calculateCost(matchingModel, usage.inputTokens, usage.outputTokens)

    return {
      result: parsedResult,
      usage: {
        model: matchingModel,
        modelDisplayName: MODEL_DISPLAY_NAMES[matchingModel] || matchingModel,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cost
      }
    }
  } catch (error) {
    logger.error('Quote extraction error:', error)
    throw new Error(`Quote extraction failed: ${error.message}`)
  }
}

/**
 * Extract text content from a PDF for reference indexing
 *
 * @param {File} pdfFile - The PDF file to extract text from
 * @returns {Promise<Object>} - Extracted text and metadata
 */
export async function extractPDFText(pdfFile) {
  const client = getGeminiClient()
  const base64Data = await fileToBase64(pdfFile)

  const prompt = `Extract all text content from this PDF document.
Return a JSON object with:
{
  "text": "full extracted text",
  "pages": [
    { "pageNumber": 1, "content": "text from page 1" }
  ],
  "title": "document title if found",
  "totalPages": number
}`

  try {
    const { response } = await generateContentWithModelFallback(client, {
      preferredModel: GEMINI_MODEL,
      purpose: 'pdf text extraction',
      contents: [
        {
          role: 'user',
          parts: [
            // Document FIRST
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: base64Data
              }
            },
            // Then the prompt
            { text: prompt }
          ]
        }
      ],
      config: {
        temperature: 0,
        maxOutputTokens: 64000,
        responseMimeType: 'application/json'
      }
    })

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text
    return JSON.parse(text)
  } catch (error) {
    logger.error('PDF text extraction error:', error)
    return {
      text: '',
      error: error.message
    }
  }
}

/**
 * Check if the Gemini API is configured and working
 */
export async function checkGeminiConnection(preferredModel = GEMINI_MODEL) {
  try {
    const client = getGeminiClient()
    const { response, model } = await generateContentWithModelFallback(client, {
      preferredModel,
      purpose: 'connection check',
      contents: [{ role: 'user', parts: [{ text: 'Say "connected" if you can read this.' }] }]
    })
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text || 'connected'
    const normalizedPreferredModel = normalizeModelName(preferredModel) || GEMINI_MODEL
    return {
      connected: true,
      response: text,
      model,
      fallbackUsed: model !== normalizedPreferredModel
    }
  } catch (error) {
    return { connected: false, error: error.message }
  }
}

/**
 * Debug function - List available models and test API connection
 * Run this in browser console: import('/src/services/gemini.js').then(m => m.debugGeminiAPI())
 */
export async function debugGeminiAPI() {
  logger.info('Debugging Gemini API connection...')

  // Check if API key is set
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!apiKey) {
    logger.error('VITE_GEMINI_API_KEY is not set in .env.local')
    return { error: 'API key not set' }
  }
  logger.info('API key found (starts with:', apiKey.substring(0, 8) + '...)')

  try {
    const client = getGeminiClient()

    // Try to list models
    logger.info('Attempting to list available models...')
    try {
      const modelsResponse = await client.models.list()
      logger.info('Available models:')
      const models = []
      for await (const model of modelsResponse) {
        logger.info('  -', model.name)
        models.push(model.name)
      }
      logger.info('')

      // Check if our target model is available
      const targetModel = GEMINI_MODEL
      const modelExists = models.some(m => m.includes(targetModel) || m.includes('gemini'))
      logger.info(`Target model "${targetModel}" available:`, modelExists ? 'Yes' : 'No')

    } catch (listError) {
      logger.warn('Could not list models:', listError.message)
    }

    // Try different model name formats
    logger.info('Testing different model name formats...')
    const modelFormats = [
      'gemini-3-pro-preview',
      'gemini-2.5-pro',
      'gemini-3-flash-preview',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash'
    ]

    for (const modelName of modelFormats) {
      try {
        const response = await client.models.generateContent({
          model: modelName,
          contents: [{ role: 'user', parts: [{ text: 'Say "ok"' }] }]
        })
        const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text
        logger.info(`"${modelName}" works. Response: ${text}`)
        return { success: true, workingModel: modelName }
      } catch (err) {
        logger.warn(`"${modelName}" failed:`, err.message?.substring(0, 80))
      }
    }

    return { error: 'No model format worked' }

  } catch (error) {
    logger.error('API Error:', error)
    return { error: error.message }
  }
}
