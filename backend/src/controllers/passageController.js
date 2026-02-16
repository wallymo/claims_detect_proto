import { ReferencePassage } from '../models/ReferencePassage.js'
import { Brand } from '../models/Brand.js'
import { embedText } from '../services/passageEmbedder.js'
import { AppError } from '../middleware/errorHandler.js'

const DEFAULT_TOP_K = 5
const DEFAULT_CANDIDATE_POOL = 20
const MAX_TOP_K = 100
const MAX_CANDIDATE_POOL = 200
const EMBEDDING_CACHE_TTL_MS = parseInt(process.env.MATCHING_EMBED_CACHE_TTL_MS || '300000', 10)
const EMBEDDING_CACHE_MAX_ENTRIES = parseInt(process.env.MATCHING_EMBED_CACHE_MAX_ENTRIES || '500', 10)
const queryEmbeddingCache = new Map()

function parsePositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function normalizeClaimText(text) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

function pruneExpiredCacheEntries(now = Date.now()) {
  for (const [key, entry] of queryEmbeddingCache.entries()) {
    if (entry.expiresAt <= now) {
      queryEmbeddingCache.delete(key)
    }
  }
}

function getCachedQueryEmbedding(cacheKey, now = Date.now()) {
  const cached = queryEmbeddingCache.get(cacheKey)
  if (!cached) return null
  if (cached.expiresAt <= now) {
    queryEmbeddingCache.delete(cacheKey)
    return null
  }
  // Touch for simple LRU behavior.
  queryEmbeddingCache.delete(cacheKey)
  queryEmbeddingCache.set(cacheKey, cached)
  return cached.embedding
}

function setCachedQueryEmbedding(cacheKey, embedding, now = Date.now()) {
  pruneExpiredCacheEntries(now)
  queryEmbeddingCache.set(cacheKey, {
    embedding,
    expiresAt: now + EMBEDDING_CACHE_TTL_MS
  })
  while (queryEmbeddingCache.size > EMBEDDING_CACHE_MAX_ENTRIES) {
    const oldestKey = queryEmbeddingCache.keys().next().value
    if (!oldestKey) break
    queryEmbeddingCache.delete(oldestKey)
  }
}

export const passageController = {
  /**
   * POST /api/brands/:brandId/passages/search
   * Body: { claim_text: string, top_k?: number, candidate_pool?: number }
   * Returns top-K most similar passages for a claim.
   */
  async search(req, res, next) {
    const requestStartedAt = Date.now()
    try {
      const brandId = parseInt(req.params.brandId, 10)
      const brand = Brand.findById(brandId)
      if (!brand) throw new AppError('Brand not found', 404)

      const { claim_text, top_k, candidate_pool } = req.body
      if (!claim_text || claim_text.trim().length === 0) {
        throw new AppError('claim_text is required', 400)
      }

      const topK = parsePositiveInt(top_k, DEFAULT_TOP_K, MAX_TOP_K)
      const requestedCandidatePool = parsePositiveInt(candidate_pool, DEFAULT_CANDIDATE_POOL, MAX_CANDIDATE_POOL)
      const candidatePool = Math.max(topK, requestedCandidatePool)
      const normalizedClaimText = normalizeClaimText(claim_text)

      // Embed the claim text (with small TTL cache by normalized claim text)
      const embeddingStartedAt = Date.now()
      let cacheHit = false
      let queryEmbedding = getCachedQueryEmbedding(normalizedClaimText)
      if (!queryEmbedding) {
        queryEmbedding = await embedText(claim_text.trim())
        setCachedQueryEmbedding(normalizedClaimText, queryEmbedding)
      } else {
        cacheHit = true
      }
      const embeddingGenerationMs = Date.now() - embeddingStartedAt

      // KNN search across all brand passages
      const retrievalStartedAt = Date.now()
      const results = ReferencePassage.searchByEmbedding(brandId, queryEmbedding, topK, candidatePool)
      const candidateRetrievalMs = Date.now() - retrievalStartedAt
      const totalRequestMs = Date.now() - requestStartedAt

      console.info({
        event: 'passages_search_timing',
        brand_id: brandId,
        top_k: topK,
        candidate_pool: candidatePool,
        cache_hit: cacheHit,
        cache_size: queryEmbeddingCache.size,
        claim_text_chars: claim_text.trim().length,
        embedding_generation_ms: embeddingGenerationMs,
        candidate_retrieval_ms: candidateRetrievalMs,
        total_request_ms: totalRequestMs,
        result_count: results.length
      })

      res.json({
        claim_text: claim_text.trim(),
        top_k: topK,
        candidate_pool: candidatePool,
        results,
        count: results.length
      })
    } catch (err) {
      next(err)
    }
  },

  /**
   * GET /api/brands/:brandId/passages/status
   * Returns embedding status for all references in a brand.
   */
  status(req, res, next) {
    try {
      const brandId = parseInt(req.params.brandId, 10)
      const brand = Brand.findById(brandId)
      if (!brand) throw new AppError('Brand not found', 404)

      const statuses = ReferencePassage.getEmbeddingStatus(brandId)
      const totalRefs = statuses.length
      const embeddedRefs = statuses.filter(s => s.embedded_count > 0).length
      const totalPassages = statuses.reduce((sum, s) => sum + (s.passage_count || 0), 0)

      res.json({
        brand_id: brandId,
        total_references: totalRefs,
        embedded_references: embeddedRefs,
        total_passages: totalPassages,
        references: statuses
      })
    } catch (err) {
      next(err)
    }
  }
}
