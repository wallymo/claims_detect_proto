/**
 * Anthropic API Service - Claude Sonnet 4.5 for PDF/Vision analysis
 *
 * This service handles:
 * - PDF document analysis and claim detection using Claude Sonnet 4.5
 * - Maintains same interface as gemini.js for easy swapping
 *
 * NOTE: Anthropic API has CORS restrictions. This service uses direct fetch
 * with appropriate headers. If CORS issues occur, a backend proxy may be needed.
 */

import { MEDICATION_PROMPT_USER, ALL_CLAIMS_PROMPT_USER } from './gemini'

// Model configuration
export const ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929'

// Friendly display names
export const MODEL_DISPLAY_NAMES = {
  'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
  'claude-sonnet-4-20250514': 'Claude Sonnet 4',
  'claude-opus-4-5-20251101': 'Claude Opus 4.5'
}

// Pricing per 1M tokens (USD)
const PRICING = {
  'claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-opus-4-5-20251101': { input: 5.00, output: 25.00 },
  'default': { input: 3.00, output: 15.00 }
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

// Same claim detection prompt as Gemini for consistency
const CLAIM_DETECTION_PROMPT = `OUTPUT FORMAT: You must respond with ONLY a JSON object. No markdown, no commentary, no explanation - just valid JSON starting with { and ending with }.

You are a veteran MLR (Medical, Legal, Regulatory) reviewer analyzing pharmaceutical promotional materials. Your job is to surface EVERY statement that could require substantiation - you'd rather flag 20 borderline phrases than let 1 real claim slip through.

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

Respond with this exact JSON structure (no other text):
{"claims": [{"claim": "[Exact phrase]", "confidence": 85, "page": 1, "x": 25.0, "y": 14.5}]}`

/**
 * Analyze a PDF document and detect claims using Claude Sonnet 4.5
 *
 * @param {Array} pageImages - Pre-rendered page images from normalizer
 * @param {Function} onProgress - Optional progress callback
 * @param {string} promptKey - Prompt key ('all', 'disease', 'drug')
 * @param {string|null} customPrompt - Optional custom prompt override
 * @returns {Promise<Object>} - Result with claims array
 */
export async function analyzeDocument(pageImages, onProgress, promptKey = 'all', customPrompt = null) {
  // Select the appropriate prompt
  let selectedPrompt
  if (customPrompt) {
    selectedPrompt = customPrompt
    console.log(`📋 Using custom prompt (${customPrompt.length} chars)`)
  } else {
    if (promptKey === 'drug') {
      selectedPrompt = MEDICATION_PROMPT_USER
    } else if (promptKey === 'disease') {
      selectedPrompt = ALL_CLAIMS_PROMPT_USER // Uses All Claims for disease state
    } else {
      selectedPrompt = CLAIM_DETECTION_PROMPT
    }
    console.log(`📋 Using ${promptKey} prompt for Claude analysis`)
  }

  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('VITE_ANTHROPIC_API_KEY is not set in .env.local')
  }

  onProgress?.(25, 'Sending to Claude Sonnet 4.5...')

  try {
    // Images already provided - no need to convert PDF

    // Anthropic API call using fetch (SDK has CORS issues in browser)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 65536, // 64K max for Claude Sonnet 4.5
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              // Send each page as an image
              ...pageImages.map(img => ({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: img.base64
                }
              })),
              {
                type: 'text',
                text: selectedPrompt
              }
            ]
          },
          {
            // Assistant prefill to force JSON output
            role: 'assistant',
            content: '{"claims": ['
          }
        ]
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()

    onProgress?.(75, 'Processing results...')

    // Extract text from Claude response
    const text = data.content?.[0]?.text || ''

    console.log('🔍 Raw Claude response (first 500 chars):', text?.substring(0, 500))

    // We used assistant prefill '{"claims": [' so prepend it to complete the JSON
    const jsonText = '{"claims": [' + text

    let result
    try {
      result = JSON.parse(jsonText)
    } catch (parseError) {
      console.error('❌ JSON parse failed:', parseError.message)
      console.error('❌ Attempted to parse:', jsonText?.substring(0, 500))
      throw new Error(`Failed to parse Claude response as JSON: ${parseError.message}`)
    }

    // Transform to frontend format
    const claims = (result.claims || []).map((claim, index) => {
      const pageNumber = Math.max(1, Number(claim.page) || 1)
      const position = (claim.x !== undefined && claim.y !== undefined)
        ? { x: Number(claim.x) || 0, y: Number(claim.y) || 0 }
        : null

      console.log(`📍 Claim ${index + 1}: x=${claim.x}, y=${claim.y}, text="${claim.claim?.slice(0, 50)}..."`)

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

    // Extract usage metadata
    const usage = data.usage || {}
    const inputTokens = usage.input_tokens || 0
    const outputTokens = usage.output_tokens || 0
    const cost = calculateCost(ANTHROPIC_MODEL, inputTokens, outputTokens)

    console.log(`✅ Detected ${claims.length} claims`)
    console.log(`💰 Usage: ${inputTokens} input + ${outputTokens} output tokens = $${cost.toFixed(4)}`)

    const pricing = PRICING[ANTHROPIC_MODEL] || PRICING['default']
    return {
      success: true,
      claims,
      usage: {
        model: ANTHROPIC_MODEL,
        modelDisplayName: MODEL_DISPLAY_NAMES[ANTHROPIC_MODEL] || ANTHROPIC_MODEL,
        inputTokens,
        outputTokens,
        cost,
        inputRate: pricing.input,   // $/1M tokens
        outputRate: pricing.output  // $/1M tokens
      }
    }
  } catch (error) {
    console.error('Claude analysis error:', error)
    return {
      success: false,
      error: error.message,
      claims: [],
      usage: null
    }
  }
}

/**
 * Check if the Anthropic API is configured and working
 */
export async function checkAnthropicConnection() {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) {
    return { connected: false, error: 'VITE_ANTHROPIC_API_KEY is not set' }
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say "connected" if you can read this.' }]
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error?.message || `HTTP ${response.status}`)
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || 'connected'
    return { connected: true, response: text }
  } catch (error) {
    return { connected: false, error: error.message }
  }
}
