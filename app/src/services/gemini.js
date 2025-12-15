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

// Claim Detection Prompt - Source of truth: docs/workflow/pharma_claims_persona.md
const CLAIM_DETECTION_PROMPT = `You are a high-recall promotional claim detection engine for pharmaceutical and healthcare marketing materials.

## OBJECTIVE
Detect ANY statement that could be interpreted as a promotional claim. Flag liberally - it is better to surface 10 borderline cases than miss 1 real claim. The human reviewer makes final judgment.

## WHAT IS A CLAIM?
Any statement, phrase, or implication that:
- Asserts a benefit, outcome, or product characteristic
- Suggests efficacy, speed, duration, or magnitude of effect
- Implies safety, tolerability, or reduced risk
- Compares to alternatives (even implicitly)
- References data, studies, or authority figures
- Promises a return to normalcy or quality of life improvement

IF IN DOUBT, FLAG IT.

## DETECTION PATTERNS (NON-EXHAUSTIVE)
These are COMMON patterns, not a complete list. Flag ANY claim-like statement, even if it doesn't match these patterns:

1. Return to Normal - "Be you again," "Get back to what you love," "Reclaim your life"
2. Speed/Magnitude - "Fast," "All-day relief," "Powerful," "24-hour protection"
3. Competitive Framing - "Smarter choice," "Advanced," "Next-generation," "Unlike other treatments"
4. Risk Minimization - "Gentle," "Simple to use," "Natural," "Well-tolerated"
5. Appeal to Authority - "Doctor recommended," "Clinically proven," "FDA approved," "#1 prescribed"
6. Quantitative Assertions - Any percentage, statistic, or numeric claim
7. Quality of Life - "Feel like yourself," "Live without limits," "Freedom from symptoms"

These patterns are hints, not limits. If something feels like a claim but doesn't fit a category above, FLAG IT ANYWAY.

## CONFIDENCE SCORING
Score how likely the text IS a promotional claim:

| Score | Meaning | Examples |
|-------|---------|----------|
| 90-100% | Obvious/explicit claim | "Reduces symptoms by 47%," "Clinically proven," "Superior efficacy" |
| 70-89% | Strong implication | "Feel like yourself again," "Works where others fail," "Powerful relief" |
| 40-69% | Possibly suggestive | "Support your health," "New formula," "Fresh start" |
| 1-39% | Borderline/contextual | "Learn more," "Talk to your doctor," "Discover the difference" |

IMPORTANT: Use the FULL range. Not everything is 85%. A vague phrase like "support" is 50%, not 80%.

## PROCESSING RULES
- Review ALL text including headers, footers, callouts, and image captions
- Flag any segment that could reasonably imply a health benefit
- Extract the EXACT phrase from the document
- Include context if the claim spans multiple sentences
- Do not exclude edge cases
- Visual descriptions count (e.g., "Image shows active person running" = potential claim)

## OUTPUT FORMAT (STRICT JSON)
Return ONLY this JSON structure, no other text:
{
  "claims": [
    {
      "claim": "[Exact extracted phrase]",
      "confidence": [0-100 integer]
    }
  ]
}

Analyze the document and return ALL potential promotional claims.`

/**
 * Analyze a PDF document and detect claims
 *
 * @param {File} pdfFile - The PDF file to analyze
 * @param {Function} onProgress - Optional progress callback
 * @returns {Promise<Object>} - Result with claims array
 */
export async function analyzeDocument(pdfFile, onProgress) {
  const client = getGeminiClient()
  const base64Data = await fileToBase64(pdfFile)

  try {
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: CLAIM_DETECTION_PROMPT },
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
        temperature: 0.1, // Low temperature for consistent, precise output
        topP: 0.8,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
      }
    })

    // Extract text from response
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text
    const result = JSON.parse(text)

    // Transform to frontend format
    const claims = (result.claims || []).map((claim, index) => ({
      id: `claim_${String(index + 1).padStart(3, '0')}`,
      text: claim.claim,
      confidence: claim.confidence / 100, // Convert 0-100 to 0-1 for frontend
      status: 'pending'
    }))

    return {
      success: true,
      claims
    }
  } catch (error) {
    console.error('Gemini analysis error:', error)
    return {
      success: false,
      error: error.message,
      claims: []
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
        temperature: 0.1,
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
        maxOutputTokens: 32768,
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
