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
export const GEMINI_MODEL = 'gemini-3-pro-preview'

// Friendly display names for models
export const MODEL_DISPLAY_NAMES = {
  'gemini-3-pro-preview': 'Gemini 3 Pro',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'gemini-2.0-flash-exp': 'Gemini 2.0 Flash',
  'gemini-1.5-flash': 'Gemini 1.5 Flash',
  'gemini-1.5-pro': 'Gemini 1.5 Pro'
}

// Pricing per 1M tokens (USD) - approximate rates for Gemini Pro
// Update these based on current Google AI pricing
const PRICING = {
  'gemini-3-pro-preview': { input: 1.25, output: 5.00 },  // $/1M tokens
  'gemini-2.0-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'default': { input: 1.25, output: 5.00 }
}

// System instruction (moved out of user prompt for efficiency)
const SYSTEM_INSTRUCTION = `You are a veteran MLR (Medical, Legal, Regulatory) reviewer for pharmaceutical promotional materials. Your mission: surface EVERY statement that could require substantiation. Flag 20 borderline phrases rather than let 1 slip through. When unsure, include it with lower confidence rather than omit.

CRITICAL DOCUMENT FORMAT: These documents are "notes pages" with TWO regions per page:
1. TOP HALF: Slide image (visual content)
2. BOTTOM HALF: Speaker notes starting with "Speaker notes" header, containing bullet points (• and ○)

You MUST extract claims from BOTH regions. The speaker notes often contain MORE substantive claims than the slides - specific statistics, study citations, clinical outcomes. Ignoring speaker notes is an unacceptable failure.`

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

// Document structure instructions for notes pages - EMPHATIC version
const DOCUMENT_STRUCTURE_INSTRUCTIONS = `
# CRITICAL: TWO-REGION DOCUMENT STRUCTURE
⚠️ THIS DOCUMENT HAS TWO DISTINCT REGIONS PER PAGE - YOU MUST ANALYZE BOTH:

**REGION 1 - SLIDE (top ~50% of page):**
Visual presentation content with titles, graphics, charts, statistics

**REGION 2 - SPEAKER NOTES (bottom ~50% of page):**
- Starts with header: "Speaker notes" or "Speaker note"
- Contains bullet points using • (main) and ○ or ▪ (sub-bullets)
- Often has MORE detailed claims than the slide itself
- Includes study citations, specific statistics, clinical data

🚨 FAILURE MODE TO AVOID: Do NOT only extract from the slide image. The speaker notes section contains critical claims that MUST be extracted. If your output contains zero claims from speaker notes (y > 55%), you have failed the task.

`

// Position instructions appended to all prompts
const POSITION_INSTRUCTIONS = `
# Position
- x: Position at the BULLET SYMBOL (• or ○) for bulleted text, NOT at the page margin
- y: vertical CENTER of claim as % (0=top, 100=bottom)
- Charts/graphs: position at LEFT EDGE of visual element
- Speaker notes claims: y will typically be 55-90% (bottom half of page)
- Speaker notes bullets: x should be ~5-8% for main bullets (•), ~8-12% for sub-bullets (○)
- IMPORTANT: Sub-bullets (○) are INDENTED further right than main bullets (•)

# EXTRACTION CHECKLIST
Before finalizing your response:
1. ☐ Did you read EVERY bullet point under "Speaker notes" headers? (bottom half of each page)
2. ☐ Do you have claims with y > 55%? (If not, you missed speaker notes)
3. ☐ For a 30-page document, expect 80-150+ claims total (slides + speaker notes combined)
4. ☐ If you have < 50 claims, go back and re-read the speaker notes sections

⚠️ The speaker notes bullets contain the MOST important claims - statistics, study citations, clinical outcomes. Do not skip them.`

// User-facing prompt for All Claims (shown in UI, editable)
export const ALL_CLAIMS_PROMPT_USER = `# Task
Extract ALL claims requiring MLR substantiation from this pharmaceutical document.

# Claim Types
**Disease/Condition:** prevalence, burden, progression stats, unmet needs, risk factors
**Product/Treatment:** efficacy, safety, dosing, MOA, formulation advantages
**Comparative:** vs alternatives, trial citations, regulatory status, guidelines
**Patient Impact:** QOL improvements, outcomes, statistics

# Rules
- Combine related statements into ONE claim if same substantiation needed
- Split only when DIFFERENT substantiation required
- Include charts/graphs/infographics with statistical claims
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
- Combine related statements if same substantiation needed
- Split only when DIFFERENT substantiation required
- Include visual elements with statistical claims

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

# Rules
- Combine related statements if same substantiation needed
- Split only when DIFFERENT substantiation required

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
 * @returns {Promise<Object>} - Result with claims array
 */
export async function analyzeDocument(pdfFile, onProgress, promptKey = 'all', customPrompt = null) {
  const client = getGeminiClient()

  // Build final prompt: custom prompt (if provided) or default, plus position instructions
  let userPrompt
  if (customPrompt) {
    userPrompt = customPrompt
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
  // Prepend document structure instructions (for notes pages) and append position instructions
  const finalPrompt = DOCUMENT_STRUCTURE_INSTRUCTIONS + userPrompt + POSITION_INSTRUCTIONS

  // Debug: confirm document structure instructions are included
  const hasDocStructure = finalPrompt.includes('Speaker notes')
  logger.info(`Final prompt: ${finalPrompt.length} chars, has speaker notes instructions: ${hasDocStructure}`)
  if (!hasDocStructure) {
    logger.error('WARNING: Document structure instructions missing from prompt!')
  }

  onProgress?.(10, 'Preparing document...')
  const base64Data = await fileToBase64(pdfFile)

  onProgress?.(25, 'Sending to AI...')

  try {
    // Use stable generateContent API with optimized config:
    // - systemInstruction: role/persona moved out of user prompt
    // - responseJsonSchema: strict output validation
    // - Document-first ordering: PDF before text prompt (per Gemini best practices)
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            // Document FIRST (recommended for single-document prompts)
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: base64Data
              }
            },
            // Then the prompt
            { text: finalPrompt }
          ]
        }
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0,    // Zero for deterministic output
        topP: 0.1,         // Low top_p for more consistent sampling
        topK: 1,           // Only consider top token (most deterministic)
        maxOutputTokens: 64000,
        responseMimeType: 'application/json',
        responseJsonSchema: CLAIMS_JSON_SCHEMA
      }
    })

    onProgress?.(75, 'Processing results...')

    // Extract text from response
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text

    logger.debug('Raw Gemini response (first 500 chars):', text?.substring(0, 500))

    // Parse JSON from response (Gemini may wrap in markdown code blocks despite responseMimeType)
    let jsonText = text
    const jsonMatch = text?.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      logger.debug('Extracted JSON from markdown code block')
      jsonText = jsonMatch[1].trim()
    }

    let result
    try {
      result = JSON.parse(jsonText)
    } catch (parseError) {
      logger.error('Gemini JSON parse failed. Raw text:', jsonText?.substring(0, 1000))
      throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`)
    }

    // Transform to frontend format
    const claims = (result.claims || []).map((claim, index) => {
      const pageNumber = Math.max(1, Number(claim.page) || 1)
      // Position from Gemini (x/y as % of page), with fallback for older responses
      const position = (claim.x !== undefined && claim.y !== undefined)
        ? { x: Number(claim.x) || 0, y: Number(claim.y) || 0 }
        : null

      // Debug: log what Gemini returned for each claim
      logger.debug(`Claim ${index + 1}: x=${claim.x}, y=${claim.y}, text="${claim.claim?.slice(0, 50)}..."`)

      return {
        id: `claim_${String(index + 1).padStart(3, '0')}`,
        text: claim.claim,
        confidence: claim.confidence / 100, // Convert 0-100 to 0-1 for frontend
        status: 'pending',
        page: pageNumber,
        position // { x, y } as % of page, or null if not provided
      }
    })

    onProgress?.(95, 'Finalizing...')

    // Extract usage metadata for cost tracking
    const usageMetadata = response.usageMetadata || {}
    const inputTokens = usageMetadata.promptTokenCount || 0
    const outputTokens = usageMetadata.candidatesTokenCount || 0
    const cost = calculateCost(GEMINI_MODEL, inputTokens, outputTokens)

    // Log for reproducibility tracking
    const modelVersion = response.modelVersion || GEMINI_MODEL
    logger.info(`[Gemini] Model: ${modelVersion}, Claims: ${claims.length}, Tokens: ${inputTokens}/${outputTokens}, Cost: $${cost.toFixed(4)}`)

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
 * @returns {Promise<Object>} - Matched reference with confidence and excerpt
 */
export async function matchClaimToReferences(claimText, references) {
  const client = getGeminiClient()

  const referenceList = references.map((ref, i) =>
    `[${i + 1}] ${ref.name}\nContent excerpt: ${ref.excerpt || 'No excerpt available'}`
  ).join('\n\n')

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

Only match if the reference actually substantiates the claim. A low confidence match is better than a false positive.`

  try {
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      }
    })

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text
    return JSON.parse(text)
  } catch (error) {
    logger.error('Reference matching error:', error)
    return {
      matched: false,
      error: error.message
    }
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
    // Document-first ordering for better multimodal processing
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
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
