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
  'gemini-3-pro-preview': 'Gemini 3 Pro',
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

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const DETECTION_PASSES = parsePositiveInt(
  import.meta.env.VITE_DETECTION_PASSES,
  2
)
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

function claimDeduplicationKey(claim) {
  const text = String(claim.claim || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const page = claim.page || 0
  const xBin = Math.round((claim.x || 0) / 5) * 5
  const yBin = Math.round((claim.y || 0) / 5) * 5
  return `${page}|${xBin}|${yBin}|${text}`
}

function mergeRawClaims(primaryClaims, visualClaims) {
  // Over-flag principle: keep every UNIQUE mention from both passes.
  // Dedup only truly identical entries (same text + same page + near-identical position).
  // Different locations of the same claim text are kept as separate mentions.
  // Filter visual-sweep claims with (0,0) coords — text echoes without real position data.
  const validVisualClaims = visualClaims.filter(c => c.x !== 0 || c.y !== 0)

  const seen = new Set()
  const merged = []

  for (const claim of primaryClaims) {
    const key = claimDeduplicationKey(claim)
    seen.add(key)
    merged.push({ ...claim, _source: 'primary' })
  }

  for (const claim of validVisualClaims) {
    const key = claimDeduplicationKey(claim)
    if (!seen.has(key)) {
      seen.add(key)
      merged.push({ ...claim, _source: 'visual-sweep' })
    }
  }

  return merged
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
Run a SECOND PASS focused on claims embedded in GRAPHICAL elements — charts, graphs, tables, infographics, and diagrams. The first pass focused on text; this pass targets visual data representations.

# What to Extract — VISUAL DATA, not just labels
Focus on the DATA the graphic is communicating, not just text around it:
- **Bar/line/pie charts**: What outcome does the chart show? If a bar represents "47% reduction" or a line shows a downward trend with a label, that is a claim. Extract the specific value and what it measures.
- **Kaplan-Meier / survival curves**: Separation between curves, hazard ratios, median survival times shown graphically.
- **Forest plots**: Point estimates, confidence intervals, overall effect sizes.
- **Tables**: EVERY data cell that states an outcome, rate, percentage, p-value, hazard ratio, odds ratio, or delta. Each cell with a distinct substantiation point is a separate claim.
- **Waterfall / spider / swimmer plots**: Individual response rates, durations, thresholds shown.
- **Infographics with numbers**: Icons paired with statistics (e.g., clock icon + "Works in 3 days"), pictographs, percentage wheels.
- **Annotation markers (†, ‡, §, *)**: Symbols appearing ON or NEAR visual elements that link to study qualifiers — both the annotated visual claim AND the footnote are claims.
${topRegionHint}

# Rules
- Read the VISUAL representation, not just surrounding text. A bar at 47% is a claim even if no text label says "47%".
- Extract only explicit values visible in the graphic. Do NOT estimate or fabricate numbers from bar heights or line positions — only extract values that are labeled or printed.
- Split separate data points into separate claims — each table cell, each bar, each curve metric.
- Do not invent values not visible in the graphic.
- If uncertain, include with lower confidence rather than omitting.

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
- Flag ALL annotation markers (†, ‡, §, *) — each dagger/double dagger references a footnote with study details, populations, or statistical qualifiers that require substantiation
- Complete, self-contained statements only

# Confidence (0-100)
90-100: Explicit stats, specific numbers | 70-89: Benefit promises, comparisons | 50-69: Borderline phrasing | 30-49: Weak promotional signal

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
- Flag ALL annotation markers (†, ‡, §, *) — each links to substantiation-requiring footnote text

# Confidence (0-100)
90-100: Explicit stats, prevalence data | 70-89: Burden assertions, unmet needs | 50-69: Borderline | 30-49: Weak contextual

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

# Confidence (0-100)
90-100: "Clinically proven to reduce X" | 70-89: "Starts working in 3 days" | 50-69: "Helps patients feel better" | 30-49: "New era in treatment"

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
export async function analyzeDocument(pdfFile, onProgress, promptKey = 'all', customPrompt = null, _pageImages = null, docType = 'speaker-notes', factInventory = '') {
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

  // Extraction instructions first (strongest signal), supplemental context at end (matches pre-regression order).
  const finalPrompt = `${promptBody}${factInventory || ''}

# Final Instruction
Extract all substantiation-requiring claims now and return ONLY JSON.`

  logger.info(
    `Final prompt: ${finalPrompt.length} chars, docType: ${docType}, custom_scaffold=${customPromptHasScaffold}`
  )

  onProgress?.(10, 'Preparing document...')
  const base64Data = await fileToBase64(pdfFile)

  onProgress?.(25, 'Sending to AI...')

  // Progress allocation: primary passes get 15-70%, visual sweep gets 70-85%, merge/finalize 85-95%
  const primaryPassWeight = 55 / DETECTION_PASSES  // Split 55% across N passes

  try {
    // Multi-pass primary extraction: run N times and union for stable recall.
    // Gemini is non-deterministic even at temperature 0 — each pass may catch
    // different claims. Union via dedup key ensures every unique mention survives.
    const allPrimaryResponses = []
    let unionedPrimaryClaims = []
    const primaryDedup = new Set()

    for (let pass = 0; pass < DETECTION_PASSES; pass++) {
      const passStart = 15 + (pass * primaryPassWeight)
      const passLabel = DETECTION_PASSES > 1 ? ` (pass ${pass + 1}/${DETECTION_PASSES})` : ''
      onProgress?.(Math.round(passStart), `Detecting claims${passLabel}...`)

      const response = await client.models.generateContent({
        model: GEMINI_MODEL,
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
              { text: finalPrompt }
            ]
          }
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0,
          topP: 0.1,
          topK: 1,
          maxOutputTokens: 64000,
          responseMimeType: 'application/json',
          responseJsonSchema: CLAIMS_JSON_SCHEMA
        }
      })

      allPrimaryResponses.push(response)

      const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text
      const json = parseJsonResponse(text, `Gemini primary pass ${pass + 1} response`)
      const passClaims = normalizeRawClaims(json.claims)

      // Union into accumulated set — dedup truly identical mentions
      let newInPass = 0
      for (const claim of passClaims) {
        const key = claimDeduplicationKey(claim)
        if (!primaryDedup.has(key)) {
          primaryDedup.add(key)
          unionedPrimaryClaims.push(claim)
          newInPass++
        }
      }

      logger.info(
        `[Gemini] Pass ${pass + 1}/${DETECTION_PASSES}: ${passClaims.length} claims detected, ${newInPass} new unique, ${unionedPrimaryClaims.length} total union`
      )
    }

    onProgress?.(72, 'Processing primary claims...')

    let visualSweepResponse = null
    let visualClaims = []
    if (GEMINI_VISUAL_SWEEP_ENABLED) {
      onProgress?.(75, 'Running visual chart/table sweep...')
      const visualSweepPrompt = buildVisualSweepPrompt(docType)

      visualSweepResponse = await client.models.generateContent({
        model: GEMINI_MODEL,
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
      })

      const visualText = visualSweepResponse.candidates?.[0]?.content?.parts?.[0]?.text || visualSweepResponse.text
      const visualJson = parseJsonResponse(visualText, 'Gemini visual sweep response')
      visualClaims = normalizeRawClaims(visualJson.claims)
    }

    onProgress?.(88, 'Merging claim passes...')
    const mergedRawClaims = mergeRawClaims(unionedPrimaryClaims, visualClaims)
    const claims = rawClaimsToFrontendClaims(mergedRawClaims)

    onProgress?.(95, 'Finalizing...')

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
    const cost = calculateCost(GEMINI_MODEL, inputTokens, outputTokens)

    // Log for reproducibility tracking
    const modelVersion = allPrimaryResponses[0]?.modelVersion || GEMINI_MODEL
    logger.info(
      `[Gemini] Model: ${modelVersion}, Claims: ${claims.length} (primary_union=${unionedPrimaryClaims.length}, visual=${visualClaims.length}, passes=${DETECTION_PASSES}, visual_enabled=${GEMINI_VISUAL_SWEEP_ENABLED}), Tokens: ${inputTokens}/${outputTokens}, Cost: $${cost.toFixed(4)}`
    )

    const pricing = PRICING[GEMINI_MODEL] || PRICING['default']
    return {
      success: true,
      claims,
      usage: {
        model: GEMINI_MODEL,
        modelDisplayName: MODEL_DISPLAY_NAMES[GEMINI_MODEL] || GEMINI_MODEL,
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
      error: error.message,
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
    // Use gemini-2.0-flash for matching — gemini-3-pro-preview doesn't support responseMimeType JSON
    const matchingModel = 'gemini-2.0-flash'
    const response = await client.models.generateContent({
      model: matchingModel,
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

  const prompt = `You are an MLR (Medical, Legal, Regulatory) reviewer checking whether a reference document contains content relevant to a specific claim. Your job is to help human reviewers find the right passages — err on the side of INCLUSION.

CLAIM: "${claimText}"

REFERENCE DOCUMENT (${referenceName}):
${referenceText}

TASK: Find the exact sentence(s) in this reference that support, partially support, or are directly relevant to this claim. Quote them VERBATIM — do not paraphrase, do not combine sentences, do not add words.

Return JSON:
{
  "supported": true or false,
  "quotes": [
    {
      "text": "exact verbatim quote copied from the reference above",
      "page_estimate": number or null
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
- Quotes must be VERBATIM text from the reference document above. Copy-paste, do not rephrase.
- Multiple quotes are allowed if multiple sentences together relate to the claim.
- Only return supported=false if the reference contains NO content relevant to the claim's topic.
- When in doubt, return supported=true — it is better to surface a potentially relevant quote than to miss a real match. Human reviewers will make the final call.`

  try {
    const matchingModel = 'gemini-2.0-flash'
    const response = await client.models.generateContent({
      model: matchingModel,
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
    // Use gemini-2.0-flash — supports responseMimeType JSON (gemini-3-pro-preview doesn't)
    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
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
export async function checkGeminiConnection() {
  try {
    const client = getGeminiClient()
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: 'Say "connected" if you can read this.' }] }]
    })
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text || 'connected'
    return { connected: true, response: text }
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
