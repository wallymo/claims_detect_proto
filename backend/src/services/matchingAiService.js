import { GoogleGenAI } from '@google/genai'

let geminiClient = null

const GEMINI_MODEL = String(process.env.VITE_GEMINI_MODEL || '').trim() || 'gemini-2.5-pro'

const MODEL_DISPLAY_NAMES = {
  'gemini-3-pro-preview': 'Gemini 3 Pro (Preview)',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'gemini-1.5-flash': 'Gemini 1.5 Flash',
  'gemini-1.5-pro': 'Gemini 1.5 Pro'
}

const PRICING = {
  'gemini-3-pro-preview': { input: 1.25, output: 5.00 },
  'gemini-2.5-pro': { input: 1.25, output: 5.00 },
  'gemini-2.5-flash': { input: 0.075, output: 0.30 },
  'gemini-2.0-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'default': { input: 1.25, output: 5.00 }
}

const GEMINI_MODEL_FALLBACK_ORDER = [
  'gemini-2.5-pro',
  'gemini-3-pro-preview'
]

const resolvedModelCache = new Map()

function normalizeModelName(model) {
  return String(model || '').trim()
}

function getClient() {
  if (geminiClient) return geminiClient

  const apiKey = process.env.VITE_GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('VITE_GEMINI_API_KEY is not set in backend environment')
  }

  geminiClient = new GoogleGenAI({ apiKey })
  return geminiClient
}

function getModelCandidates(preferredModel) {
  const preferred = normalizeModelName(preferredModel) || GEMINI_MODEL
  const cached = normalizeModelName(resolvedModelCache.get(preferred))
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

function isRateLimitError(error) {
  const msg = String(error?.message || '').toLowerCase()
  return msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('resource_exhausted')
}

function backoffDelay(attempt) {
  const base = 1000 * Math.pow(2, attempt)
  const jitter = Math.random() * 500
  return base + jitter
}

async function generateContentWithModelFallback({ preferredModel, contents, config, purpose = 'request' }) {
  const client = getClient()
  const preferred = normalizeModelName(preferredModel) || GEMINI_MODEL
  const candidates = getModelCandidates(preferred)
  let lastError = null

  for (let i = 0; i < candidates.length; i += 1) {
    const model = candidates[i]
    try {
      const response = await client.models.generateContent({
        model,
        contents,
        config
      })

      resolvedModelCache.set(preferred, model)
      if (model !== preferred) {
        console.warn(`[matching-ai] Using fallback model "${model}" for ${purpose} (preferred "${preferred}")`)
      }

      return { response, model }
    } catch (error) {
      lastError = error
      const hasNext = i < candidates.length - 1
      if (!hasNext || !shouldRetryWithFallbackModel(error)) {
        throw error
      }
      const nextModel = candidates[i + 1]
      console.warn(`[matching-ai] Model "${model}" failed for ${purpose}: ${shortErrorMessage(error)}. Trying "${nextModel}".`)

      // Brief backoff before trying fallback model on rate limit errors
      if (isRateLimitError(error)) {
        const delay = backoffDelay(0)
        console.warn(`[matching-ai] Rate limited — waiting ${Math.round(delay)}ms before fallback`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError || new Error('No Gemini model could complete request')
}

function parseJsonResponse(rawText, contextLabel = 'Gemini response') {
  const text = typeof rawText === 'string' ? rawText.trim() : ''
  if (!text) throw new Error(`${contextLabel} was empty`)

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
  if (fencedMatch?.[1]) pushCandidate(fencedMatch[1])

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
      // Try next candidate form.
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

function calculateCost(model, inputTokens, outputTokens) {
  const pricing = PRICING[model] || PRICING.default
  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  return inputCost + outputCost
}

export async function matchClaimToReferences(claimText, references, preferredModel = GEMINI_MODEL) {
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

  const { response, model } = await generateContentWithModelFallback({
    preferredModel,
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
  const cost = calculateCost(model, usage.inputTokens, usage.outputTokens)

  return {
    result: parsedResult,
    usage: {
      model,
      modelDisplayName: MODEL_DISPLAY_NAMES[model] || model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cost
    }
  }
}

export async function extractSupportingQuote(claimText, referenceText, referenceName, preferredModel = GEMINI_MODEL) {
  const prompt = `You are an MLR (Medical, Legal, Regulatory) reviewer checking whether a reference document contains content relevant to a specific claim. Your job is to help human reviewers find the right passages - err on the side of INCLUSION without fabricating evidence.

CLAIM: "${claimText}"

REFERENCE DOCUMENT (${referenceName}):
${referenceText}

TASK: Find the exact sentence(s), table cells, chart labels, or figure captions in this reference that support, partially support, or are directly relevant to this claim. Quote them VERBATIM - do not paraphrase, do not combine sentences, do not add words.

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
- Return supported=true if the reference contains text that SUBSTANTIATES, PARTIALLY SUPPORTS, or is DIRECTLY RELEVANT to the claim.
- Graphs and tables are valid evidence when their labels/cells/captions contain the relevant data point.
- Quotes must be VERBATIM text from the reference document above.
- Multiple quotes are allowed if multiple sentences together relate to the claim.
- Only return supported=false if the reference contains NO content relevant to the claim's topic.
- Use only evidence present in the provided extracted reference text.`

  const { response, model } = await generateContentWithModelFallback({
    preferredModel,
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
  const cost = calculateCost(model, usage.inputTokens, usage.outputTokens)

  return {
    result: parsedResult,
    usage: {
      model,
      modelDisplayName: MODEL_DISPLAY_NAMES[model] || model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cost
    }
  }
}

