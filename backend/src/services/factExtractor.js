import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import { fileURLToPath } from 'url'
import { GoogleGenAI } from '@google/genai'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const PYTHON_BIN = path.join(PROJECT_ROOT, 'scripts/.venv/bin/python3')
const LLAMA_PARSE_SCRIPT = path.join(PROJECT_ROOT, 'scripts/llamaparse_reference_facts.py')

const DEFAULT_PROVIDER = 'gemini'
const DEFAULT_GEMINI_MODEL = 'gemini-3-pro-preview'
const DEFAULT_LLAMA_PARSE_TIER = process.env.LLAMA_PARSE_TIER || 'agentic'
const DEFAULT_LLAMA_PARSE_VERSION = process.env.LLAMA_PARSE_VERSION || 'latest'

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
const MAX_LLAMA_FACTS_PER_PAGE = 10

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by',
  'for', 'from', 'had', 'has', 'have', 'if', 'in', 'into', 'is', 'it',
  'its', 'may', 'more', 'most', 'no', 'not', 'of', 'on', 'or', 'our', 'so',
  'such', 'than', 'that', 'the', 'their', 'them', 'there', 'these', 'they',
  'this', 'those', 'to', 'was', 'were', 'which', 'with', 'would'
])

const CATEGORY_PATTERNS = {
  dosage: [
    /\b(?:dose|dosage|dosed|dosing|mg\b|mcg\b|g\b|ml\b|tablet|capsule|once daily|twice daily|titrat|administer|administration|maintenance dose)\b/i
  ],
  safety: [
    /\b(?:adverse event|adverse reaction|safety|warning|warnings|boxed warning|black box|contraindicat|toxicity|tolerab|discontinuation|serious adverse|side effect)\b/i
  ],
  mechanism: [
    /\b(?:mechanism of action|pharmacology|pharmacokinetic|pharmacodynamic|receptor|agonist|antagonist|binds|binding|channel|half-life)\b/i
  ],
  population: [
    /\b(?:patients?|subjects?|adults?|pediatric|children|cohort|baseline|inclusion|exclusion|demographic|population|participants?)\b/i
  ],
  endpoint: [
    /\b(?:primary endpoint|secondary endpoint|endpoint|end point|composite endpoint|outcome measure|response rate|seizure frequency)\b/i
  ],
  statistical: [
    /\b(?:p\s*[<=>]\s*0?\.\d+|confidence interval|hazard ratio|odds ratio|risk ratio|relative risk|ci\b|median|mean|standard deviation|nnt)\b/i
  ],
  regulatory: [
    /\b(?:approved|approval|indication|indicated|prescribing information|label|labeling|fda|ema|boxed warning|contraindicated|medication guide)\b/i
  ],
  efficacy: [
    /\b(?:reduction|reduced|improvement|improved|efficacy|effective|superior|inferior|compared with|versus|vs\.?|responders?|benefit|treated)\b/i
  ]
}

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

function hasGeminiConfig() {
  return Boolean(process.env.VITE_GEMINI_API_KEY)
}

function hasLlamaParseConfig() {
  return Boolean(process.env.LLAMA_CLOUD_API_KEY)
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function stripMarkdown(value) {
  return normalizeWhitespace(
    String(value || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^[#>\-\*\+\d.)\s]+/gm, '')
      .replace(/\|/g, ' ')
      .replace(/[_~]/g, ' ')
  )
}

function splitIntoSentences(value) {
  const text = normalizeWhitespace(value)
  if (!text) return []
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9(])/)
    .map(sentence => sentence.trim())
    .filter(Boolean)
}

function cleanCandidate(value) {
  return normalizeWhitespace(
    String(value || '')
      .replace(/\s*[\u2020\u2021\u00a7]+\s*/g, match => ` ${match.trim()} `)
      .replace(/\s+/g, ' ')
  )
}

function looksLikeNoise(value) {
  const text = normalizeWhitespace(value)
  if (!text) return true
  if (text.length < 24) return true
  if (text.split(' ').length < 4) return true
  if (/^(copyright|all rights reserved|references|contents|table of contents)\b/i.test(text)) return true
  return false
}

function scoreFactCandidate(text) {
  let score = 0
  if (/\b\d+(?:\.\d+)?%?\b/.test(text)) score += 2
  if (/\b(?:p\s*[<=>]\s*0?\.\d+|hr\s*0?\.\d+|hazard ratio|odds ratio|confidence interval|n\s*[=:]?\s*\d+)\b/i.test(text)) score += 2
  if (/[\u2020\u2021\u00a7]/.test(text)) score += 1
  if (/\b(?:phase\s+[ivx]+|randomized|double-blind|placebo|trial|study|cohort)\b/i.test(text)) score += 1

  for (const patterns of Object.values(CATEGORY_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        score += 1
        break
      }
    }
  }

  return score
}

function extractMarkdownBlocks(page) {
  const markdown = String(page?.markdown || '')
  const text = String(page?.text || '')
  const blocks = new Set()

  for (const part of markdown.split(/\n{2,}/)) {
    const cleaned = cleanCandidate(stripMarkdown(part))
    if (!looksLikeNoise(cleaned)) blocks.add(cleaned)
  }

  for (const line of text.split(/\n+/)) {
    const cleaned = cleanCandidate(line)
    if (!looksLikeNoise(cleaned)) blocks.add(cleaned)
  }

  return [...blocks]
}

function extractCandidateSegments(page) {
  const segments = []
  const blocks = extractMarkdownBlocks(page)

  for (const block of blocks) {
    const score = scoreFactCandidate(block)
    if (score >= 2) {
      segments.push({ text: block, score })
    }

    for (const sentence of splitIntoSentences(block)) {
      if (looksLikeNoise(sentence)) continue
      const sentenceScore = scoreFactCandidate(sentence)
      if (sentenceScore >= 2) {
        segments.push({ text: cleanCandidate(sentence), score: sentenceScore })
      }
    }
  }

  const deduped = new Map()
  for (const segment of segments) {
    const key = segment.text.toLowerCase()
    const existing = deduped.get(key)
    if (!existing || segment.score > existing.score) {
      deduped.set(key, segment)
    }
  }

  return [...deduped.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.text.length - b.text.length
    })
    .slice(0, MAX_LLAMA_FACTS_PER_PAGE)
}

function extractWordTokens(text) {
  return String(text || '')
    .toLowerCase()
    .match(/[a-z][a-z0-9-]{2,}/g) || []
}

function extractNumericKeywords(text) {
  const matches = []
  const patterns = [
    /\bp\s*[<=>]\s*0?\.\d+\b/gi,
    /\bn\s*[=:]?\s*\d+\b/gi,
    /\bhr\s*0?\.\d+\b/gi,
    /\b\d+(?:\.\d+)?%?\b/g
  ]
  for (const pattern of patterns) {
    const found = text.match(pattern) || []
    for (const value of found) {
      matches.push(normalizeWhitespace(value).toLowerCase())
    }
  }
  return matches
}

function buildKeywords(text) {
  const keywords = []
  const seen = new Set()

  const push = (value) => {
    const normalized = normalizeWhitespace(value).toLowerCase()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    keywords.push(normalized)
  }

  const wordTokens = extractWordTokens(text).filter(token => !STOP_WORDS.has(token))
  const bigrams = []
  for (let i = 0; i < wordTokens.length - 1; i += 1) {
    const first = wordTokens[i]
    const second = wordTokens[i + 1]
    if (STOP_WORDS.has(first) || STOP_WORDS.has(second)) continue
    bigrams.push(`${first} ${second}`)
  }

  extractNumericKeywords(text).forEach(push)
  bigrams.slice(0, 2).forEach(push)
  wordTokens.forEach(push)

  const finalKeywords = keywords.slice(0, 6)
  return finalKeywords.length >= 3 ? finalKeywords : [...new Set([...finalKeywords, ...wordTokens])].slice(0, 3)
}

function classifyCategory(text) {
  const scores = Object.fromEntries(Object.keys(CATEGORY_PATTERNS).map(category => [category, 0]))
  const lower = text.toLowerCase()

  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(lower)) {
        scores[category] += 1
      }
    }
  }

  if (/\b\d+(?:\.\d+)?%?\b/.test(text)) {
    scores.efficacy += 1
    scores.statistical += 1
  }

  const orderedCategories = [
    'dosage',
    'regulatory',
    'safety',
    'mechanism',
    'endpoint',
    'efficacy',
    'population',
    'statistical'
  ]

  let bestCategory = 'efficacy'
  let bestScore = -1

  for (const category of orderedCategories) {
    const score = scores[category]
    if (score > bestScore) {
      bestCategory = category
      bestScore = score
    }
  }

  return bestCategory
}

function normalizeFact(rawFact, index, pageCount) {
  const text = normalizeWhitespace(rawFact?.text)
  if (!text) return null

  const category = CATEGORY_PATTERNS[rawFact?.category] ? rawFact.category : classifyCategory(text)
  const keywords = Array.isArray(rawFact?.keywords) && rawFact.keywords.length > 0
    ? rawFact.keywords.map(keyword => normalizeWhitespace(keyword).toLowerCase()).filter(Boolean).slice(0, 6)
    : buildKeywords(text)

  return {
    id: `fact_${String(index + 1).padStart(3, '0')}`,
    text,
    category,
    keywords: keywords.length > 0 ? keywords : buildKeywords(text),
    page: sanitizeFactPage(rawFact?.page, pageCount)
  }
}

export function normalizeExtractedFacts(facts, pageCount) {
  const seen = new Set()
  const unique = []

  for (const fact of facts || []) {
    const text = normalizeWhitespace(fact?.text)
    if (!text) continue
    const key = text.slice(0, 120).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push({ ...fact, text })
  }

  return unique
    .map((fact, index) => normalizeFact(fact, index, pageCount))
    .filter(Boolean)
}

export function buildHeuristicFactsFromParsedPages(parsedPages, options = {}) {
  const pageCount = Number.isFinite(options.pageCount) ? options.pageCount : parsedPages?.length
  const facts = []

  for (const page of parsedPages || []) {
    const pageNumber = sanitizeFactPage(page?.page ?? page?.page_number, pageCount)
    for (const segment of extractCandidateSegments(page)) {
      facts.push({
        text: segment.text,
        category: classifyCategory(segment.text),
        keywords: buildKeywords(segment.text),
        page: pageNumber
      })
    }
  }

  return normalizeExtractedFacts(facts, pageCount)
}

function stripCodeFences(text) {
  return String(text || '').replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
}

function resolveReferenceInput(input, options = {}) {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return {
      contentText: typeof input.contentText === 'string' ? input.contentText : '',
      filePath: input.filePath ? resolveFilePath(input.filePath) : null,
      pageCount: Number.isFinite(input.pageCount) ? input.pageCount : options.pageCount,
      model: input.model || options.model,
      provider: input.provider || options.provider,
      timeoutMs: input.timeoutMs || options.timeoutMs
    }
  }

  return {
    contentText: typeof input === 'string' ? input : '',
    filePath: options.filePath ? resolveFilePath(options.filePath) : null,
    pageCount: Number.isFinite(options.pageCount) ? options.pageCount : null,
    model: options.model,
    provider: options.provider,
    timeoutMs: options.timeoutMs
  }
}

function resolveFilePath(filePath) {
  if (!filePath) return null
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
}

export function resolveReferenceAnalysisProvider(value = process.env.REFERENCE_ANALYSIS_PROVIDER) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'llamaparse' || normalized === 'llama_parse' || normalized === 'llama-parse') {
    return 'llamaparse'
  }
  return DEFAULT_PROVIDER
}

export function getModelUsedLabel(provider, model) {
  if (provider === 'llamaparse') return 'llamaparse'
  return model || DEFAULT_GEMINI_MODEL
}

/**
 * Sanitize a fact's page number against the actual document page count.
 * Only clamps finite integers. Preserves null/undefined/non-numeric as null.
 * NEVER fabricates a page number from nothing.
 */
export function sanitizeFactPage(page, pageCount) {
  const parsed = typeof page === 'number' ? page : parseInt(page, 10)
  if (!Number.isFinite(parsed)) return null
  if (!Number.isFinite(pageCount) || pageCount <= 0) return parsed
  return Math.min(Math.max(Math.round(parsed), 1), pageCount)
}

async function extractFactsWithGemini(contentText, options = {}) {
  const apiKey = process.env.VITE_GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('VITE_GEMINI_API_KEY not set in environment')
  }
  if (!contentText) {
    return { facts: [], modelUsed: getModelUsedLabel('gemini', options.model) }
  }

  const ai = new GoogleGenAI({ apiKey })
  const model = options.model || DEFAULT_GEMINI_MODEL

  const chunks = chunkText(contentText)
  const allFacts = []

  for (let i = 0; i < chunks.length; i += 1) {
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

    const text = String(response.text || '').trim()
    const jsonStr = stripCodeFences(text)

    try {
      const facts = JSON.parse(jsonStr)
      if (Array.isArray(facts)) {
        allFacts.push(...facts)
      }
    } catch (parseErr) {
      console.error(`Failed to parse Gemini response for chunk ${i + 1}:`, parseErr.message)
      console.error('Raw response:', text.slice(0, 500))
    }
  }

  return {
    facts: normalizeExtractedFacts(allFacts, options.pageCount),
    modelUsed: getModelUsedLabel('gemini', model)
  }
}

async function parseWithLlamaParse(filePath, options = {}) {
  if (!hasLlamaParseConfig()) {
    throw new Error('LLAMA_CLOUD_API_KEY not set in environment')
  }
  if (!filePath) {
    throw new Error('LlamaParse requires a reference file path')
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Reference file not found for LlamaParse: ${filePath}`)
  }
  if (!fs.existsSync(PYTHON_BIN)) {
    throw new Error('Python venv not found. Run: python3 -m venv scripts/.venv && scripts/.venv/bin/pip install -r scripts/requirements.txt')
  }

  const args = [
    LLAMA_PARSE_SCRIPT,
    filePath,
    '--tier',
    options.tier || DEFAULT_LLAMA_PARSE_TIER,
    '--version',
    options.version || DEFAULT_LLAMA_PARSE_VERSION
  ]

  const { stdout } = await execFileAsync(
    PYTHON_BIN,
    args,
    {
      cwd: PROJECT_ROOT,
      env: process.env,
      maxBuffer: 50 * 1024 * 1024,
      timeout: options.timeoutMs || 120_000
    }
  )

  const parsed = JSON.parse(stdout)
  return Array.isArray(parsed?.pages) ? parsed.pages : []
}

async function extractFactsWithLlamaParse(input, options = {}) {
  const pages = await parseWithLlamaParse(input.filePath, options)
  return {
    facts: buildHeuristicFactsFromParsedPages(pages, { pageCount: input.pageCount || pages.length }),
    modelUsed: getModelUsedLabel('llamaparse')
  }
}

export async function extractFactsDetailed(input, options = {}) {
  const normalizedInput = resolveReferenceInput(input, options)
  const provider = resolveReferenceAnalysisProvider(normalizedInput.provider)

  if (provider === 'llamaparse') {
    try {
      const result = await extractFactsWithLlamaParse(normalizedInput, options)
      return { ...result, provider, fallbackUsed: false }
    } catch (error) {
      const canFallback = hasGeminiConfig() && normalizedInput.contentText
      if (!canFallback) throw error

      console.warn(`[factExtractor] LlamaParse failed, falling back to Gemini: ${error.message}`)
      const fallbackResult = await extractFactsWithGemini(normalizedInput.contentText, options)
      return { ...fallbackResult, provider: 'gemini', fallbackUsed: true, fallbackReason: error.message }
    }
  }

  const result = await extractFactsWithGemini(normalizedInput.contentText, options)
  return { ...result, provider: 'gemini', fallbackUsed: false }
}

export async function extractFacts(input, options = {}) {
  const { facts } = await extractFactsDetailed(input, options)
  return facts
}
