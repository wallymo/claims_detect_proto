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
 * Generate embedding for a single text using Gemini embedding API.
 * Returns a Buffer containing the Float32Array data.
 */
export async function embedText(text, options = {}) {
  const apiKey = process.env.VITE_GEMINI_API_KEY
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY not set in environment')

  const ai = new GoogleGenAI({ apiKey })
  const model = options.model || EMBEDDING_MODEL

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
}

/**
 * Chunk and embed a full reference document.
 * Returns array of passage objects ready for ReferencePassage.createPassages().
 */
export async function embedReference(contentText, options = {}) {
  const { chunkSize, overlap } = resolveChunkingOptions(contentText.length, options)
  const chunks = chunkText(contentText, chunkSize, overlap)

  const passages = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]

    const embedding = await embedText(chunk.text, options)

    passages.push({
      passage_index: i,
      passage_text: chunk.text,
      start_char: chunk.startChar,
      end_char: chunk.endChar,
      page_estimate: estimatePage(chunk.startChar),
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
