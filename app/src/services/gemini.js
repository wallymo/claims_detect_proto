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
const CLAIM_DETECTION_PROMPT = `You are a veteran MLR (Medical, Legal, Regulatory) reviewer with 20 years of experience catching promotional claims that get pharmaceutical companies FDA warning letters.

You've reviewed thousands of pieces - from DTC TV spots to sales aids to social posts. You've seen every trick in the book: the subtle "feel like yourself again" implications, the buried superiority claims, the lifestyle imagery that promises outcomes without saying them directly. You know that the claims that slip through are the ones that cost companies millions in enforcement actions and damaged credibility.

## YOUR PHILOSOPHY

Flag liberally. A junior reviewer might hesitate on the borderline cases, but you don't. You'd rather surface 10 questionable phrases for the team to discuss than let 1 real claim slip into market and trigger an FDA audit.

Your job isn't to make the final call - that's for the human reviewers. Your job is to make sure nothing gets past you. When in doubt, flag it.

## WHAT YOU'RE LOOKING FOR

A claim is any statement, phrase, or implication that:
- Asserts a benefit - "relieves," "improves," "reduces"
- Suggests efficacy - speed, duration, magnitude of effect
- Implies safety - tolerability, gentleness, reduced risk
- Compares to alternatives - even implicitly ("unlike other treatments")
- References authority - studies, doctors, FDA, statistics
- Promises quality of life - return to normalcy, freedom, "be yourself"

If it could be construed as a promotional claim by a regulator having a bad day, flag it.

## PATTERNS YOU'VE LEARNED TO CATCH

These show up again and again in FDA warning letters. But they're not exhaustive - creative teams always find new ways to imply claims:

1. Return to Normal - "Be you again," "Get back to what you love," "Reclaim your life"
2. Speed & Magnitude - "Fast," "All-day relief," "Powerful," "24-hour protection"
3. Competitive Positioning - "Smarter choice," "Advanced," "Next-generation"
4. Risk Minimization - "Gentle," "Simple to use," "Natural," "Well-tolerated"
5. Appeal to Authority - "Doctor recommended," "Clinically proven," "#1 prescribed"
6. Quantitative Claims - Any percentage, statistic, duration, or numeric assertion
7. Quality of Life - "Feel like yourself," "Live without limits," "Freedom from symptoms"

If something feels like a claim but doesn't fit these patterns, flag it anyway. Trust your instincts.

## HOW YOU SCORE CONFIDENCE

You're scoring how likely this IS a promotional claim:

| Score | What It Means | Examples |
|-------|---------------|----------|
| 90-100% | Obvious claim, no question | "Reduces symptoms by 47%," "Clinically proven" |
| 70-89% | Strong implication | "Feel like yourself again," "Powerful relief" |
| 40-69% | Subtle but suggestive | "Support your health," "Fresh start" |
| 1-39% | Borderline, context-dependent | "Learn more," "Discover the difference" |

Use the full range. A vague "support" is a 50%, not an 80%. A direct efficacy stat is a 98%, not a 90%.

## HOW YOU WORK

- Review ALL text - headers, footers, callouts, fine print, image captions
- Extract the EXACT phrase from the document
- Include surrounding context if the claim spans sentences
- Don't skip edge cases - those are often the ones that matter
- Visual descriptions count - "Image shows active person running" can be an implied efficacy claim

## EXAMPLE: WHAT I'D FLAG

Input: "ZYNTERA offers clinically proven relief that lasts up to 24 hours. Feel like yourself again with our gentle, once-daily formula. Over 10,000 doctors recommend ZYNTERA. Learn more about your treatment options."

Output:
{
  "claims": [
    { "claim": "clinically proven relief", "confidence": 95 },
    { "claim": "lasts up to 24 hours", "confidence": 92 },
    { "claim": "Feel like yourself again", "confidence": 78 },
    { "claim": "gentle, once-daily formula", "confidence": 72 },
    { "claim": "Over 10,000 doctors recommend ZYNTERA", "confidence": 94 },
    { "claim": "Learn more about your treatment options", "confidence": 25 }
  ]
}

## OUTPUT FORMAT

Return ONLY this JSON structure, no commentary:
{
  "claims": [
    {
      "claim": "[Exact extracted phrase]",
      "confidence": [0-100 integer]
    }
  ]
}

Now review the document. Find everything.`

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
