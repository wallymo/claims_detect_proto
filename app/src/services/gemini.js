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

// Claim Detection Prompt - Category checklist approach for exhaustive, consistent detection
const CLAIM_DETECTION_PROMPT = `You are a veteran MLR (Medical, Legal, Regulatory) reviewer. Your job is to surface EVERY potential claim for human review - you'd rather flag 20 borderline phrases than let 1 real claim slip through.

## MANDATORY CATEGORY CHECKLIST

You MUST check each category below and report ALL instances found. Do not skip categories. If a category has no claims, explicitly state "None found."

### CATEGORY 1: EFFICACY CLAIMS
Statements about how well something works: "reduces," "improves," "relieves," "treats," "prevents," speed of action, duration of effect, magnitude of benefit.
**Examples that ARE claims:**
- "Reduces symptoms by 47%" → 95% confidence
- "Fast-acting relief" → 80% confidence
- "Improvement in 2 weeks" → 90% confidence

### CATEGORY 2: SAFETY CLAIMS
Statements about tolerability, side effects, or risk: "well-tolerated," "gentle," "safe," "low risk," "minimal side effects," "natural."
**Examples that ARE claims:**
- "Well-tolerated in clinical trials" → 92% confidence
- "Gentle on your system" → 75% confidence
- "Natural ingredients" → 70% confidence

### CATEGORY 3: STATISTICAL/QUANTITATIVE CLAIMS
Any number, percentage, duration, or measurable assertion - these ALWAYS need substantiation.
**Examples that ARE claims:**
- "47% reduction in events" → 98% confidence
- "24-hour protection" → 85% confidence
- "3 out of 4 doctors recommend" → 95% confidence
- "17% mortality rate" → 95% confidence (disease stat)

### CATEGORY 4: COMPARATIVE CLAIMS
Statements comparing to alternatives, competitors, or standard of care - even implicit comparisons.
**Examples that ARE claims:**
- "Superior to placebo" → 95% confidence
- "Advanced formula" → 65% confidence
- "Next-generation treatment" → 70% confidence
- "Unlike other treatments" → 80% confidence

### CATEGORY 5: QUALITY OF LIFE CLAIMS
Promises about returning to normal, lifestyle benefits, freedom from symptoms.
**Examples that ARE claims:**
- "Feel like yourself again" → 82% confidence
- "Get back to what you love" → 78% confidence
- "Live without limits" → 75% confidence
- "Reclaim your life" → 80% confidence

### CATEGORY 6: AUTHORITY/ENDORSEMENT CLAIMS
References to studies, doctors, FDA, awards, rankings, expert opinions.
**Examples that ARE claims:**
- "Clinically proven" → 90% confidence
- "#1 prescribed" → 92% confidence
- "Doctor recommended" → 88% confidence
- "FDA approved for..." → 85% confidence

### CATEGORY 7: MECHANISM OF ACTION CLAIMS
Statements about how a treatment works biologically or chemically.
**Examples that ARE claims:**
- "Blocks the enzyme responsible for..." → 85% confidence
- "Targets inflammation at the source" → 80% confidence
- "Key mediator of tissue damage" → 75% confidence

### CATEGORY 8: DISEASE/EPIDEMIOLOGY CLAIMS
Statistics about disease prevalence, incidence, mortality, or patient populations.
**Examples that ARE claims:**
- "Affects 1 in 4 adults" → 90% confidence
- "Leading cause of death" → 88% confidence
- "50,000 new cases annually" → 92% confidence

## CONFIDENCE SCORING

| Score | Meaning | When to use |
|-------|---------|-------------|
| 90-100 | Definite claim, needs substantiation | Direct stats, explicit efficacy, specific numbers |
| 70-89 | Strong implication | Quality of life promises, implicit comparisons |
| 50-69 | Suggestive language | Vague benefits, "support," "help" |
| 30-49 | Borderline | Context-dependent phrases |

## YOUR PROCESS

1. **Inventory**: List every text element on each page (headlines, stats, bullets, body text, footnotes, graph labels)
2. **Category sweep**: Go through each of the 8 categories above and find ALL matching phrases
3. **No early stopping**: Even if you found 15 claims, keep checking remaining categories

## OUTPUT FORMAT

Return ONLY this JSON:
{
  "inventory": [
    { "page": 1, "elements": ["Headline: ...", "Stat: ...", "Body: ..."] },
    { "page": 2, "elements": ["..."] }
  ],
  "categoryFindings": {
    "efficacy": ["list of claims found or 'None found'"],
    "safety": ["..."],
    "statistical": ["..."],
    "comparative": ["..."],
    "qualityOfLife": ["..."],
    "authority": ["..."],
    "mechanism": ["..."],
    "diseaseStats": ["..."]
  },
  "claims": [
    { "claim": "[Exact phrase from document]", "confidence": 85, "page": 1, "category": "efficacy" }
  ]
}

Now analyze the document. Check EVERY category. Find EVERYTHING.`

/**
 * Analyze a PDF document and detect claims
 *
 * @param {File} pdfFile - The PDF file to analyze
 * @param {Function} onProgress - Optional progress callback
 * @returns {Promise<Object>} - Result with claims array
 */
export async function analyzeDocument(pdfFile, onProgress) {
  const client = getGeminiClient()

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
        temperature: 0, // Zero temperature for deterministic, reproducible output
        topP: 1,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
      }
    })

    onProgress?.(75, 'Processing results...')

    // Extract text from response
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text
    const result = JSON.parse(text)

    // Log inventory for debugging
    if (result.inventory) {
      console.log('📋 Document Inventory:')
      result.inventory.forEach(page => {
        console.log(`  Page ${page.page}: ${page.elements?.length || 0} elements`)
        page.elements?.forEach(el => console.log(`    - ${el}`))
      })
      const totalElements = result.inventory.reduce((sum, p) => sum + (p.elements?.length || 0), 0)
      console.log(`  Total elements inventoried: ${totalElements}`)
    }

    // Log category findings for debugging (shows exhaustive category sweep)
    if (result.categoryFindings) {
      console.log('📊 Category Findings:')
      Object.entries(result.categoryFindings).forEach(([category, findings]) => {
        const count = Array.isArray(findings) ? findings.length : 0
        const status = findings === 'None found' || (Array.isArray(findings) && findings[0] === 'None found') ? '∅' : `${count} found`
        console.log(`  ${category}: ${status}`)
      })
    }

    // Transform to frontend format
    // Note: position is NOT included here - it's added later by PDF.js text matching
    const claims = (result.claims || []).map((claim, index) => ({
      id: `claim_${String(index + 1).padStart(3, '0')}`,
      text: claim.claim,
      confidence: claim.confidence / 100, // Convert 0-100 to 0-1 for frontend
      status: 'pending',
      page: claim.page || 1, // Page number from Gemini, fallback to 1
      category: claim.category || 'unknown' // Claim category from checklist
    }))

    onProgress?.(95, 'Finalizing...')

    console.log(`✅ Detected ${claims.length} claims`)

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
