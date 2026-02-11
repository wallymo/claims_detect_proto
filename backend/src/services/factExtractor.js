import { GoogleGenAI } from '@google/genai'

const EXTRACTION_PROMPT = `You are a pharmaceutical regulatory expert. Extract every substantiable fact from this reference document.

A "substantiable fact" is any statement that could be cited to support a claim in a promotional piece. This includes:
- Efficacy data (response rates, reduction percentages, survival data, primary/secondary endpoints)
- Safety findings (adverse events, incidence rates, contraindications, warnings, black box items)
- Dosage information (recommended doses, titration schedules, administration routes)
- Mechanism of action (how the drug works, receptor targets, pharmacology)
- Population details (inclusion/exclusion criteria, demographics, special populations)
- Endpoint definitions (primary endpoints, secondary endpoints, composite endpoints)
- Statistical findings (p-values, confidence intervals, hazard ratios, odds ratios, NNT)
- Regulatory status (approval dates, indications, formulations, boxed warnings)
- Annotation markers (†, ‡, §, *, ** — these link to footnotes with study details)

For each fact, provide:
- "id": Sequential ID like "fact_001", "fact_002"
- "text": The complete factual statement, including exact numbers and context
- "category": One of: efficacy, safety, dosage, mechanism, population, endpoint, statistical, regulatory
- "keywords": Array of 3-6 searchable terms (numbers, drug names, conditions, key phrases)
- "page": Approximate page number (1-based), or null if unclear

IMPORTANT:
- Extract EVERY substantiable data point — over-extract rather than under-extract
- Include exact numbers, percentages, and p-values when present
- Preserve study names and trial identifiers
- Each annotation marker (†, ‡, etc.) and its associated footnote is a separate fact
- Combine related statements only if they reference the exact same data point

Return ONLY a JSON array. No markdown, no explanation. Example:
[
  {
    "id": "fact_001",
    "text": "Drug X showed 47% reduction in seizure frequency vs placebo (p<0.001, N=1,200)",
    "category": "efficacy",
    "keywords": ["47%", "seizure frequency", "placebo", "p<0.001"],
    "page": 3
  }
]

If the document contains no extractable facts, return an empty array: []`

// ~4000 words per chunk with 200-word overlap
const CHUNK_SIZE = 24000
const CHUNK_OVERLAP = 1200

function chunkText(text) {
  if (text.length <= CHUNK_SIZE) return [text]

  const chunks = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length)
    chunks.push(text.slice(start, end))
    start = end - CHUNK_OVERLAP
    if (start + CHUNK_OVERLAP >= text.length) break
  }
  return chunks
}

function deduplicateFacts(facts) {
  const seen = new Set()
  const unique = []
  for (const fact of facts) {
    // Use first 80 chars of text as dedup key
    const key = fact.text.slice(0, 80).toLowerCase().trim()
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(fact)
    }
  }
  // Re-number IDs sequentially
  return unique.map((f, i) => ({
    ...f,
    id: `fact_${String(i + 1).padStart(3, '0')}`
  }))
}

export async function extractFacts(contentText, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set in environment')
  }

  const ai = new GoogleGenAI({ apiKey })
  const model = options.model || 'gemini-2.5-flash'

  const chunks = chunkText(contentText)
  const allFacts = []

  for (let i = 0; i < chunks.length; i++) {
    const chunkLabel = chunks.length > 1
      ? `\n\n[Document chunk ${i + 1} of ${chunks.length}]`
      : ''

    const response = await ai.models.generateContent({
      model,
      contents: `${EXTRACTION_PROMPT}${chunkLabel}\n\n---\n\n${chunks[i]}`,
      config: {
        temperature: 0,
        topP: 0.1,
        topK: 1
      }
    })

    const text = response.text.trim()

    // Strip markdown code fences if present
    const jsonStr = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

    try {
      const facts = JSON.parse(jsonStr)
      if (Array.isArray(facts)) {
        allFacts.push(...facts)
      }
    } catch (parseErr) {
      console.error(`Failed to parse Gemini response for chunk ${i + 1}:`, parseErr.message)
      console.error('Raw response:', text.slice(0, 500))
      // Continue with other chunks rather than failing entirely
    }
  }

  return deduplicateFacts(allFacts)
}
