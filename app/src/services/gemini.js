/**
 * Gemini API Service - Single Source of Truth for all Gemini interactions
 *
 * This service handles:
 * - PDF document analysis and claim detection
 * - Reference matching between claims and knowledge base
 * - Text extraction from documents
 */

import { GoogleGenAI } from '@google/genai'

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

// Backend-only instructions appended to all prompts
const POSITION_INSTRUCTIONS = `

POSITION: Return the x/y coordinates where a marker pin should be placed for each claim:
- x: LEFT EDGE of the claim text as percentage (0 = page left, 100 = page right)
- y: vertical center of the claim text as percentage (0 = page top, 100 = page bottom)
- The pin will appear AT these exact coordinates, so position at the LEFT EDGE of text, not center
- For charts/images: position at the LEFT EDGE of the visual element
- Example: text starting 20% from left at 30% down the page = x:20, y:30

IMPORTANT: Charts, graphs, and infographics that display statistics or make comparative claims MUST be flagged. The visual nature doesn't exempt them from substantiation requirements.

Return ONLY this JSON:
{
  "claims": [
    { "claim": "[Exact phrase from document]", "confidence": 85, "page": 1, "x": 25.0, "y": 14.5 }
  ]
}`

// User-facing prompt for All Claims (shown in UI, editable)
export const ALL_CLAIMS_PROMPT_USER = `You are a veteran MLR (Medical, Legal, Regulatory) reviewer analyzing pharmaceutical promotional materials. Surface EVERY statement that could require substantiation — flag 20 borderline phrases rather than let 1 slip through.

Identify ALL claims — any statement requiring substantiation:

Disease & Condition:
- Prevalence, burden, or progression statistics
- Unmet need or treatment gap assertions
- Risk factors, symptoms, or diagnostic criteria

Product & Treatment:
- Efficacy, onset, duration, or outcomes
- Safety, tolerability, side effects, or interactions
- Dosage, administration, or convenience
- Mechanism of action
- Formulation or delivery advantages

Comparative & Authority:
- Superiority or equivalence vs. alternatives
- Clinical trial citations or study references
- Regulatory status, approvals, or endorsements
- Guidelines or expert recommendations

Patient Impact:
- Quality of life or lifestyle improvements
- Statistics, percentages, or quantitative data

Claim Boundaries:
- Combine related statements supporting the SAME assertion into ONE claim
- Split only when statements need DIFFERENT substantiation
- Claims must be complete, self-contained statements
- Every statistic requires substantiation regardless of visual treatment

Confidence Scoring (0-100):
- 90-100: Definite — explicit stats, direct efficacy claims, specific numbers
- 70-89: Strong — benefit promises, implicit comparisons, authoritative language
- 50-69: Borderline — suggestive phrasing a cautious reviewer might flag
- 30-49: Weak signal — promotional in context, worth a second look

When unsure, include it with lower confidence rather than omit.

Now analyze the document. Find everything that could require substantiation.`

// User-facing prompt for Disease State claims (shown in UI, editable)
export const DISEASE_STATE_PROMPT_USER = `You are a veteran MLR (Medical, Legal, Regulatory) reviewer analyzing pharmaceutical promotional materials. Surface EVERY statement about disease states and medical conditions that could require substantiation — flag 20 borderline phrases rather than let 1 slip through.

Identify ALL disease and condition claims — any statement requiring substantiation:

Disease & Condition:
- Prevalence, burden, or progression statistics
- Unmet need or treatment gap assertions
- Risk factors, symptoms, or diagnostic criteria
- Epidemiological data or population statistics
- Disease impact on quality of life
- Natural history or disease trajectory
- Diagnostic challenges or delays
- Healthcare utilization or economic burden

Claim Boundaries:
- Combine related statements supporting the SAME assertion into ONE claim
- Split only when statements need DIFFERENT substantiation
- Claims must be complete, self-contained statements
- Every statistic requires substantiation regardless of visual treatment

Confidence Scoring (0-100):
- 90-100: Definite — explicit stats, specific numbers, prevalence data
- 70-89: Strong — burden assertions, unmet need statements, authoritative language
- 50-69: Borderline — suggestive phrasing a cautious reviewer might flag
- 30-49: Weak signal — contextual statements worth a second look

When unsure, include it with lower confidence rather than omit.

Now analyze the document. Find everything about disease states and conditions that could require substantiation.`

// User-facing prompt for Medication claims (shown in UI, editable)
export const MEDICATION_PROMPT_USER = `Role: Veteran MLR reviewer. Surface EVERY statement that could require substantiation — better to flag 20 borderline phrases than let 1 slip through.

What is a Medication Claim?

A substantiable statement about a drug, biologic, or medical product, including:

- Efficacy: How well it works, onset, duration, or treatment outcomes
- Safety/Tolerability: Risk profile, side effects, interactions, or absence thereof
- Dosage/Administration: Dosing schedule, ease of use, convenience
- Mechanism of Action: How the product works biologically or chemically
- Formulation Superiority: Novel delivery, once-daily vs. BID, etc.
- Comparative Statements: Better/faster/longer than alternatives or standard of care
- Authority References: Citing clinical trials, regulatory status, endorsements
- Patient Benefit or QOL: Improvements to lifestyle, functioning, satisfaction

Claim Boundaries:
- Combine related statements that support the same assertion into one claim
- Split if different substantiation would be needed
- Claims must be complete, self-contained statements

Confidence Scoring:
- 90-100: Definite claim — "Clinically proven to reduce A1c"
- 70-89: Strong implication — "Starts working in just 3 days"
- 50-69: Suggestive or borderline — "Helps patients feel better faster"
- 30-49: Weak signal, worth second look — "New era in diabetes management"

When unsure, include it with lower confidence rather than omit.

Now analyze the document. Find everything that could require substantiation.`

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
    console.log(`📋 Using custom prompt (${customPrompt.length} chars)`)
  } else {
    if (promptKey === 'drug') {
      userPrompt = MEDICATION_PROMPT_USER
    } else if (promptKey === 'disease') {
      userPrompt = DISEASE_STATE_PROMPT_USER
    } else {
      userPrompt = ALL_CLAIMS_PROMPT_USER
    }
    console.log(`📋 Using default prompt for: ${promptKey}`)
  }
  const finalPrompt = userPrompt + POSITION_INSTRUCTIONS

  onProgress?.(10, 'Preparing document...')
  const base64Data = await fileToBase64(pdfFile)

  onProgress?.(25, 'Sending to AI...')

  try {
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: finalPrompt },
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: base64Data
              }
            }
          ]
        }
      ],
      config: {
        temperature: 0, // Zero temperature for deterministic, reproducible output
        topP: 1,
        maxOutputTokens: 64000, // Max output tokens
        responseMimeType: 'application/json'
      }
    })

    onProgress?.(75, 'Processing results...')

    // Extract text from response
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text

    console.log('🔍 Raw Gemini response (first 500 chars):', text?.substring(0, 500))

    // Parse JSON from response (Gemini may wrap in markdown code blocks despite responseMimeType)
    let jsonText = text
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      console.log('📦 Extracted JSON from markdown code block')
      jsonText = jsonMatch[1].trim()
    }

    let result
    try {
      result = JSON.parse(jsonText)
    } catch (parseError) {
      console.error('❌ JSON parse failed. Raw text:', jsonText?.substring(0, 1000))
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
      console.log(`📍 Claim ${index + 1}: x=${claim.x}, y=${claim.y}, text="${claim.claim?.slice(0, 50)}..."`)

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

    console.log(`✅ Detected ${claims.length} claims`)
    console.log(`💰 Usage: ${inputTokens} input + ${outputTokens} output tokens = $${cost.toFixed(4)}`)

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
    console.error('Gemini analysis error:', error)
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
    console.error('Reference matching error:', error)
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
    const response = await client.models.generateContent({
      model: GEMINI_MODEL, // Use flash for faster text extraction
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: base64Data
              }
            }
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
    console.error('PDF text extraction error:', error)
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
  console.log('🔍 Debugging Gemini API connection...\n')

  // Check if API key is set
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!apiKey) {
    console.error('❌ VITE_GEMINI_API_KEY is not set in .env.local')
    return { error: 'API key not set' }
  }
  console.log('✅ API key found (starts with:', apiKey.substring(0, 8) + '...)')

  try {
    const client = getGeminiClient()

    // Try to list models
    console.log('\n📋 Attempting to list available models...')
    try {
      const modelsResponse = await client.models.list()
      console.log('Available models:')
      const models = []
      for await (const model of modelsResponse) {
        console.log('  -', model.name)
        models.push(model.name)
      }
      console.log('\n')

      // Check if our target model is available
      const targetModel = GEMINI_MODEL
      const modelExists = models.some(m => m.includes(targetModel) || m.includes('gemini'))
      console.log(`Target model "${targetModel}" available:`, modelExists ? '✅ Yes' : '❌ No')

    } catch (listError) {
      console.log('⚠️ Could not list models:', listError.message)
    }

    // Try different model name formats
    console.log('\n🧪 Testing different model name formats...')
    const modelFormats = [
      'gemini-1.5-flash',
      'models/gemini-1.5-flash',
      'gemini-1.5-flash-latest',
      'gemini-2.0-flash',
      'models/gemini-2.0-flash',
      'gemini-2.0-flash-exp'
    ]

    for (const modelName of modelFormats) {
      try {
        const response = await client.models.generateContent({
          model: modelName,
          contents: [{ role: 'user', parts: [{ text: 'Say "ok"' }] }]
        })
        const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text
        console.log(`✅ "${modelName}" works! Response: ${text}`)
        return { success: true, workingModel: modelName }
      } catch (err) {
        console.log(`❌ "${modelName}" failed:`, err.message?.substring(0, 80))
      }
    }

    return { error: 'No model format worked' }

  } catch (error) {
    console.error('❌ API Error:', error)
    return { error: error.message }
  }
}
