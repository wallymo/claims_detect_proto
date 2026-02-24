import { GoogleGenAI } from '@google/genai'

const EMBEDDING_MODEL = 'gemini-embedding-001'
const CHUNK_SIZE = 2400    // ~500-600 words
const CHUNK_OVERLAP = 400  // ~100 words
const DENSE_DOC_THRESHOLD = 120000
const DENSE_CHUNK_SIZE = 1800
const DENSE_CHUNK_OVERLAP = 300
const EMBEDDING_DIMS = 768 // Trimmed via MRL from 3072 default
const SENTENCE_LOOKBACK = 240

/**
 * Split text into overlapping chunks.
 * Tries to break at sentence boundaries when possible.
 */
export function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text || text.length === 0) return []
  if (text.length <= chunkSize) {
    return [{ text, startChar: 0, endChar: text.length }]
  }

  const chunks = []
  let start = 0

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length)

    // Try to break at a sentence boundary (. ! ? followed by space or newline)
    if (end < text.length) {
      const searchStart = Math.max(end - SENTENCE_LOOKBACK, start)
      const segment = text.slice(searchStart, end)
      const sentenceMatches = [...segment.matchAll(/[.!?]\s+(?=[A-Z])/g)]
      if (sentenceMatches.length > 0) {
        const sentenceEnd = sentenceMatches[sentenceMatches.length - 1].index
        if (sentenceEnd !== undefined && sentenceEnd > segment.length * 0.35) {
          end = searchStart + sentenceEnd + 1
        }
      }
    }

    chunks.push({
      text: text.slice(start, end),
      startChar: start,
      endChar: end
    })

    // Move forward by (chunkSize - overlap), but at least 1 char
    const step = Math.max(end - start - overlap, 1)
    start = start + step

    // Avoid tiny trailing chunks
    if (text.length - start < overlap) {
      // Extend last chunk to end of text
      if (chunks.length > 0) {
        const last = chunks[chunks.length - 1]
        last.text = text.slice(last.startChar)
        last.endChar = text.length
      }
      break
    }
  }

  return chunks
}

export function resolveChunkingOptions(contentLength, options = {}) {
  const dense = contentLength >= DENSE_DOC_THRESHOLD
  const defaultChunkSize = dense ? DENSE_CHUNK_SIZE : CHUNK_SIZE
  const defaultOverlap = dense ? DENSE_CHUNK_OVERLAP : CHUNK_OVERLAP

  const chunkSize = Number.isFinite(options.chunkSize) && options.chunkSize > 0
    ? options.chunkSize
    : defaultChunkSize
  const overlap = Number.isFinite(options.chunkOverlap) && options.chunkOverlap >= 0
    ? Math.min(options.chunkOverlap, Math.max(chunkSize - 1, 0))
    : defaultOverlap

  return {
    chunkSize,
    overlap
  }
}

/**
 * Estimate page number from character offset.
 * Average page is ~3000 chars (typical for PDF-extracted text).
 */
export function estimatePage(charOffset, charsPerPage = 3000) {
  return Math.floor(charOffset / charsPerPage) + 1
}

/**
 * Resolve actual page number from character offset using page boundaries.
 * Uses binary search for efficiency. Falls back to estimatePage if no boundaries.
 */
export function resolvePageFromBoundaries(charOffset, pageBoundaries) {
  if (!pageBoundaries || pageBoundaries.length === 0) return null

  // Handle underflow: offset before first boundary → first page
  if (charOffset < pageBoundaries[0].startChar) {
    return pageBoundaries[0].page
  }

  // Handle overflow: offset beyond last boundary → last page
  const last = pageBoundaries[pageBoundaries.length - 1]
  if (charOffset >= last.endChar) {
    return last.page
  }

  // Binary search: find the page whose range contains charOffset
  let lo = 0
  let hi = pageBoundaries.length - 1

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const boundary = pageBoundaries[mid]
    if (charOffset < boundary.startChar) {
      hi = mid - 1
    } else if (charOffset >= boundary.endChar) {
      lo = mid + 1
    } else {
      return boundary.page
    }
  }

  // Offset is in a separator gap between pages — return the preceding page
  // (hi points to the page just before the gap)
  if (hi >= 0) return pageBoundaries[hi].page
  return pageBoundaries[0].page
}

const EMBED_MAX_RETRIES = 3

function isRetryableError(error) {
  const msg = String(error?.message || '').toLowerCase()
  return msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') ||
    msg.includes('resource_exhausted') || msg.includes('503') || msg.includes('unavailable')
}

/**
 * Generate embedding for a single text using Gemini embedding API.
 * Returns a Buffer containing the Float32Array data.
 * Retries with exponential backoff on 429/503 errors.
 */
export async function embedText(text, options = {}) {
  const apiKey = process.env.VITE_GEMINI_API_KEY
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY not set in environment')

  const ai = new GoogleGenAI({ apiKey })
  const model = options.model || EMBEDDING_MODEL
  let lastError = null

  for (let attempt = 0; attempt <= EMBED_MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.embedContent({
        model,
        contents: text,
        config: {
          outputDimensionality: options.dimensions || EMBEDDING_DIMS
        }
      })

      const values = response.embeddings[0].values
      const float32 = new Float32Array(values)
      return Buffer.from(float32.buffer)
    } catch (error) {
      lastError = error
      if (attempt < EMBED_MAX_RETRIES && isRetryableError(error)) {
        const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500
        console.warn(`[embedText] Attempt ${attempt + 1}/${EMBED_MAX_RETRIES + 1} failed (${error.message}). Retrying in ${Math.round(delay)}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      } else {
        throw error
      }
    }
  }

  throw lastError
}

/**
 * Chunk and embed a full reference document.
 * Returns array of passage objects ready for ReferencePassage.createPassages().
 *
 * @param {string} contentText - Full document text
 * @param {Object} options
 * @param {Array} options.pageBoundaries - From extractTextByPage(). Provides real page numbers.
 * @param {number} options.pageCount - Total page count. Used for improved estimation when no boundaries.
 */
export async function embedReference(contentText, options = {}) {
  const { chunkSize, overlap } = resolveChunkingOptions(contentText.length, options)
  const chunks = chunkText(contentText, chunkSize, overlap)
  const { pageBoundaries, pageCount } = options

  // Compute improved charsPerPage when boundaries aren't available
  const charsPerPage = (pageCount && pageCount > 0)
    ? Math.max(1, Math.round(contentText.length / pageCount))
    : 3000

  const passages = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]

    const embedding = await embedText(chunk.text, options)

    // Resolve page: real boundaries > improved estimate > default estimate
    const pageEstimate = resolvePageFromBoundaries(chunk.startChar, pageBoundaries)
      ?? estimatePage(chunk.startChar, charsPerPage)

    passages.push({
      passage_index: i,
      passage_text: chunk.text,
      start_char: chunk.startChar,
      end_char: chunk.endChar,
      page_estimate: pageEstimate,
      embedding,
      embedding_model: options.model || EMBEDDING_MODEL
    })

    // Brief delay between API calls to respect rate limits
    if (i < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  return passages
}
