import { ReferenceFact } from '../models/ReferenceFact.js'
import { Reference } from '../models/Reference.js'
import { Brand } from '../models/Brand.js'
import { extractFacts } from '../services/factExtractor.js'
import { AppError } from '../middleware/errorHandler.js'

function cosineSimilarity(bufA, bufB) {
  const a = new Float32Array(bufA.buffer, bufA.byteOffset, bufA.byteLength / 4)
  const b = new Float32Array(bufB.buffer, bufB.byteOffset, bufB.byteLength / 4)
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export const factController = {
  getFacts(req, res, next) {
    try {
      const refId = parseInt(req.params.refId, 10)
      const ref = Reference.findById(refId)
      if (!ref) throw new AppError('Reference not found', 404)

      const result = ReferenceFact.findByReferenceId(refId)
      if (!result) {
        return res.json({ reference_id: refId, facts: [], extraction_status: null })
      }
      res.json({
        reference_id: refId,
        facts: result.facts,
        extraction_status: result.extraction_status,
        model_used: result.model_used,
        confirmed_count: result.confirmed_count,
        rejected_count: result.rejected_count,
        updated_at: result.updated_at
      })
    } catch (err) {
      next(err)
    }
  },

  async triggerExtraction(req, res, next) {
    try {
      const refId = parseInt(req.params.refId, 10)
      const ref = Reference.findById(refId)
      if (!ref) throw new AppError('Reference not found', 404)
      if (!ref.content_text) throw new AppError('Reference has no extracted text', 400)

      // Mark as pending immediately
      ReferenceFact.updateStatus(refId, 'extracting')
      res.json({ message: 'Extraction started', reference_id: refId })

      // Run extraction async (non-blocking)
      extractFacts(ref.content_text, { pageCount: ref.page_count })
        .then(facts => {
          ReferenceFact.createOrUpdate(refId, facts, 'indexed', 'gemini-3.1-pro-preview')
          console.log(`Indexed ref ${refId} (${ref.display_alias}): ${facts.length} facts`)
        })
        .catch(err => {
          console.error(`Extraction failed for ref ${refId}:`, err.message)
          ReferenceFact.updateStatus(refId, 'failed', err.message)
        })
    } catch (err) {
      next(err)
    }
  },

  getSummary(req, res, next) {
    try {
      const brandId = parseInt(req.params.brandId, 10)
      const brand = Brand.findById(brandId)
      if (!brand) throw new AppError('Brand not found', 404)

      const summary = ReferenceFact.getSummaryByBrandId(brandId)
      res.json({ brand_id: brandId, references: summary })
    } catch (err) {
      next(err)
    }
  },

  async searchFacts(req, res, next) {
    try {
      const brandId = parseInt(req.params.brandId, 10)
      const brand = Brand.findById(brandId)
      if (!brand) throw new AppError('Brand not found', 404)

      const { claim_text } = req.body
      if (!claim_text || typeof claim_text !== 'string' || claim_text.trim().length === 0) {
        throw new AppError('claim_text is required and must be a non-empty string', 400)
      }

      // Get all facts with embeddings for this brand
      const factSets = ReferenceFact.findByBrandIdWithEmbeddings(brandId)
      if (factSets.length === 0) {
        return res.json({ results: [], count: 0 })
      }

      // Embed the claim
      const { embedText } = await import('../services/passageEmbedder.js')
      const queryEmbedding = await embedText(claim_text.trim())

      // Cosine similarity search across fact embeddings
      const results = factSets
        .filter(fs => fs.embedding)
        .map(fs => {
          const similarity = cosineSimilarity(queryEmbedding, fs.embedding)
          return {
            reference_id: fs.reference_id,
            display_alias: fs.display_alias,
            facts: fs.facts,
            similarity
          }
        })
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5)

      res.json({ results, count: results.length })
    } catch (err) {
      next(err)
    }
  },

  updateFeedback(req, res, next) {
    try {
      const factId = req.params.factId
      const { reference_id, decision } = req.body
      if (!reference_id) throw new AppError('reference_id is required', 400)
      if (!decision || !['confirmed', 'rejected'].includes(decision)) {
        throw new AppError('decision must be "confirmed" or "rejected"', 400)
      }

      const result = ReferenceFact.updateFeedback(reference_id, factId, decision)
      if (!result) throw new AppError('Reference facts not found', 404)
      res.json({ message: 'Feedback recorded', confirmed_count: result.confirmed_count, rejected_count: result.rejected_count })
    } catch (err) {
      next(err)
    }
  }
}
