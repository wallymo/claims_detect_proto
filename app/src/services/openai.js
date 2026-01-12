/**
 * OpenAI API Service - GPT-4o for PDF/Vision analysis
 *
 * This service handles:
 * - PDF document analysis and claim detection using GPT-4o vision
 * - Maintains same interface as gemini.js for easy swapping
 *
 * Updated to use the new Responses API (2025):
 * - Uses client.responses.create() instead of chat.completions.create()
 * - Uses input[] array with input_text and input_file content types
 * - Uses text.format for structured JSON output
 */

import OpenAI from 'openai'
import { MEDICATION_PROMPT_USER, ALL_CLAIMS_PROMPT_USER, DISEASE_STATE_PROMPT_USER } from './gemini'
import { logger } from '@/utils/logger'

// Singleton client instance
let openaiClient = null

// Initialize the OpenAI client
const getOpenAIClient = () => {
  if (openaiClient) return openaiClient

  const apiKey = import.meta.env.VITE_OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('VITE_OPENAI_API_KEY is not set in .env.local')
  }
  openaiClient = new OpenAI({
    apiKey,
    dangerouslyAllowBrowser: true // Required for client-side usage
  })
  return openaiClient
}

// Model configuration - using GPT-4o (gpt-5 available but keeping 4o for cost)
export const OPENAI_MODEL = 'gpt-4o'

// Friendly display names
export const MODEL_DISPLAY_NAMES = {
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-5': 'GPT-5'
}

// Pricing per 1M tokens (USD)
const PRICING = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-5': { input: 2.50, output: 10.00 }, // Placeholder - update when pricing confirmed
  'default': { input: 2.50, output: 10.00 }
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
 * Convert a File object to base64
 */
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// JSON output instructions - OpenAI requires "json" in the prompt when using response_format
const JSON_OUTPUT_INSTRUCTIONS = `

POSITION: Return the x/y coordinates where a marker pin should be placed for each claim:
- x: LEFT EDGE of the claim text as percentage (0 = page left, 100 = page right)
- y: vertical center of the claim text as percentage (0 = page top, 100 = page bottom)
- The pin will appear AT these exact coordinates, so position at the LEFT EDGE of text, not center

Return ONLY valid JSON in this format:
{
  "claims": [
    { "claim": "[Exact phrase from document]", "confidence": 85, "page": 1, "x": 25.0, "y": 14.5 }
  ]
}`

// Same claim detection prompt as Gemini for consistency
const CLAIM_DETECTION_PROMPT = `You are a veteran MLR (Medical, Legal, Regulatory) reviewer analyzing pharmaceutical promotional materials. Your job is to surface EVERY statement that could require substantiation - you'd rather flag 20 borderline phrases than let 1 real claim slip through.

Scan this document and identify all claims. A claim is any statement that:
- Makes a verifiable assertion about efficacy, safety, or outcomes
- Uses statistics, percentages, or quantitative data
- Implies superiority or comparison
- References studies, endorsements, or authority
- Promises benefits or quality of life improvements

IMPORTANT - Claim boundaries:
- Combine related sentences that support the SAME assertion into ONE claim (e.g., a statistic followed by its context)
- Only split into separate claims when statements make DISTINCT assertions requiring DIFFERENT substantiation
- A claim should be the complete, self-contained statement - not sentence fragments
- Every statistic requires substantiation - whether it appears as a headline or embedded in text

For each claim, rate your confidence (0-100):
- 90-100: Definite claim - explicit stats, direct efficacy statements, specific numbers that clearly need substantiation
- 70-89: Strong implication - benefit promises, implicit comparisons, authoritative language
- 50-69: Borderline - suggestive phrasing that a cautious reviewer might flag
- 30-49: Weak signal - could be promotional in certain contexts, worth a second look

POSITION: Return the x/y coordinates where a marker pin should be placed for each claim:
- x: LEFT EDGE of the claim text as percentage (0 = page left, 100 = page right)
- y: vertical center of the claim text as percentage (0 = page top, 100 = page bottom)
- The pin will appear AT these exact coordinates, so position at the LEFT EDGE of text, not center
- For charts/images: position at the LEFT EDGE of the visual element
- Example: text starting 20% from left at 30% down the page = x:20, y:30

IMPORTANT: Charts, graphs, and infographics that display statistics or make comparative claims MUST be flagged. The visual nature doesn't exempt them from substantiation requirements.

Trust your judgment. If you're unsure whether something is a claim, include it with a lower confidence score rather than omitting it.

Return ONLY this JSON:
{
  "claims": [
    { "claim": "[Exact phrase from document]", "confidence": 85, "page": 1, "x": 25.0, "y": 14.5 }
  ]
}

Now analyze the document. Find everything that could require substantiation.`

/**
 * Analyze a document and detect claims using OpenAI Responses API
 *
 * Uses the new Responses API (2025) with:
 * - input[] array with input_text and input_file content types
 * - text.format for structured JSON output
 *
 * @param {File|Blob} pdfFile - PDF file (unused when pageImages provided)
 * @param {Function} onProgress - Optional progress callback
 * @param {string} promptKey - Prompt key ('all', 'disease', 'drug')
 * @param {string|null} customPrompt - Optional custom prompt override
 * @param {Array|null} pageImages - Pre-rendered page images [{page, base64}] for vision analysis
 * @returns {Promise<Object>} - Result with claims array
 */
export async function analyzeDocument(pdfFile, onProgress, promptKey = 'all', customPrompt = null, pageImages = null) {
  // Select the appropriate prompt - no need for "json" keyword with text.format
  let selectedPrompt
  if (customPrompt) {
    selectedPrompt = customPrompt + JSON_OUTPUT_INSTRUCTIONS
    logger.debug(`Using custom prompt (${customPrompt.length} chars)`)
  } else {
    if (promptKey === 'drug') {
      selectedPrompt = MEDICATION_PROMPT_USER + JSON_OUTPUT_INSTRUCTIONS
    } else if (promptKey === 'disease') {
      selectedPrompt = DISEASE_STATE_PROMPT_USER + JSON_OUTPUT_INSTRUCTIONS
    } else {
      selectedPrompt = ALL_CLAIMS_PROMPT_USER + JSON_OUTPUT_INSTRUCTIONS
    }
    logger.info(`Using ${promptKey} prompt for OpenAI analysis`)
  }

  const client = getOpenAIClient()

  onProgress?.(25, 'Sending to OpenAI...')

  try {
    // Build content array using new Responses API format
    let contentParts
    if (pageImages && pageImages.length > 0) {
      logger.info(`Using ${pageImages.length} pre-rendered page images for OpenAI`)
      contentParts = [
        { type: 'input_text', text: selectedPrompt },
        // Send each page as an image using input_image type
        ...pageImages.map(img => ({
          type: 'input_image',
          image_url: `data:image/png;base64,${img.base64}`,
          detail: 'high'
        }))
      ]
    } else {
      // Use native PDF with input_file type
      logger.info('Using native PDF for OpenAI')
      const pdfBase64 = await fileToBase64(pdfFile)
      const filename = pdfFile.name || 'document.pdf'
      contentParts = [
        { type: 'input_text', text: selectedPrompt },
        {
          type: 'input_file',
          filename: filename,
          file_data: `data:application/pdf;base64,${pdfBase64}`
        }
      ]
    }

    // Use the new Responses API
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: [
        {
          role: 'user',
          content: contentParts
        }
      ],
      // Structured output using text.format (replaces response_format)
      text: {
        format: {
          type: 'json_schema',
          name: 'claims_response',
          schema: {
            type: 'object',
            properties: {
              claims: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    claim: { type: 'string' },
                    confidence: { type: 'number' },
                    page: { type: 'number' },
                    x: { type: 'number' },
                    y: { type: 'number' }
                  },
                  required: ['claim', 'confidence', 'page', 'x', 'y'],
                  additionalProperties: false
                }
              }
            },
            required: ['claims'],
            additionalProperties: false
          },
          strict: true
        }
      },
      temperature: 0
    })

    onProgress?.(75, 'Processing results...')

    // New API returns output_text directly
    const text = response.output_text || ''

    logger.debug('Raw OpenAI response (first 500 chars):', text?.substring(0, 500))

    const result = JSON.parse(text)

    // Transform to frontend format
    const claims = (result.claims || []).map((claim, index) => {
      const pageNumber = Math.max(1, Number(claim.page) || 1)
      const position = (claim.x !== undefined && claim.y !== undefined)
        ? { x: Number(claim.x) || 0, y: Number(claim.y) || 0 }
        : null

      logger.debug(`Claim ${index + 1}: x=${claim.x}, y=${claim.y}, text="${claim.claim?.slice(0, 50)}..."`)

      return {
        id: `claim_${String(index + 1).padStart(3, '0')}`,
        text: claim.claim,
        confidence: claim.confidence / 100,
        status: 'pending',
        page: pageNumber,
        position
      }
    })

    onProgress?.(95, 'Finalizing...')

    // Extract usage metadata from new API format
    const usage = response.usage || {}
    const inputTokens = usage.prompt_tokens || usage.input_tokens || 0
    const outputTokens = usage.completion_tokens || usage.output_tokens || 0
    const cost = calculateCost(OPENAI_MODEL, inputTokens, outputTokens)

    logger.info(`Detected ${claims.length} claims`)
    logger.info(`Usage: ${inputTokens} input + ${outputTokens} output tokens = $${cost.toFixed(4)}`)

    const pricing = PRICING[OPENAI_MODEL] || PRICING['default']
    return {
      success: true,
      claims,
      usage: {
        model: OPENAI_MODEL,
        modelDisplayName: MODEL_DISPLAY_NAMES[OPENAI_MODEL] || OPENAI_MODEL,
        inputTokens,
        outputTokens,
        cost,
        inputRate: pricing.input,   // $/1M tokens
        outputRate: pricing.output  // $/1M tokens
      }
    }
  } catch (error) {
    logger.error('OpenAI analysis error:', error)
    return {
      success: false,
      error: error.message,
      claims: [],
      usage: null
    }
  }
}

/**
 * Check if the OpenAI API is configured and working
 */
export async function checkOpenAIConnection() {
  try {
    const client = getOpenAIClient()
    // Use the new Responses API for connection check
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: 'Say "connected" if you can read this.'
    })
    const text = response.output_text || 'connected'
    return { connected: true, response: text }
  } catch (error) {
    return { connected: false, error: error.message }
  }
}
