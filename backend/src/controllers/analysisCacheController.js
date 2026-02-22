import { AnalysisCache } from '../models/AnalysisCache.js'
import { AppError } from '../middleware/errorHandler.js'
import { env } from '../config/env.js'

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function stripDiagnostics(payload) {
  if (!payload || typeof payload !== 'object') return payload
  const sanitized = cloneJson(payload)

  delete sanitized.diagnostics
  if (Array.isArray(sanitized.claims)) {
    sanitized.claims = sanitized.claims.map((claim) => {
      if (!claim || typeof claim !== 'object') return claim
      const next = { ...claim }
      delete next.diagnostics
      return next
    })
  }
  return sanitized
}

function validateKey(key) {
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    throw new AppError('cache key is required', 400)
  }
}

export const analysisCacheController = {
  get(req, res, next) {
    try {
      if (!env.ANALYSIS_CACHE_ENABLED) {
        return res.json({ cache: null, disabled: true })
      }

      const key = req.query.key
      validateKey(key)
      const cache = AnalysisCache.findByKey(key, { touch: true })
      res.json({ cache })
    } catch (err) {
      next(err)
    }
  },

  upsert(req, res, next) {
    try {
      if (!env.ANALYSIS_CACHE_ENABLED) {
        return res.json({ saved: false, disabled: true })
      }

      const { key, meta, payload } = req.body || {}
      validateKey(key)
      if (!meta || typeof meta !== 'object') throw new AppError('meta is required', 400)
      if (!payload || typeof payload !== 'object') throw new AppError('payload is required', 400)

      const requiredMeta = [
        'cache_version',
        'file_sha256',
        'model',
        'prompt_key',
        'prompt_hash',
        'doc_type',
        'reference_fingerprint'
      ]
      for (const field of requiredMeta) {
        if (!meta[field] || typeof meta[field] !== 'string') {
          throw new AppError(`meta.${field} is required`, 400)
        }
      }

      const sanitizedPayload = env.ANALYSIS_CACHE_STORE_DIAGNOSTICS
        ? payload
        : stripDiagnostics(payload)

      const parsedBrandId = Number.parseInt(meta.brand_id, 10)
      const brandId = Number.isFinite(parsedBrandId) && parsedBrandId > 0 ? parsedBrandId : null

      const payloadJson = JSON.stringify(sanitizedPayload)
      const payloadSize = Buffer.byteLength(payloadJson, 'utf8')
      if (payloadSize > env.ANALYSIS_CACHE_MAX_PAYLOAD_BYTES) {
        throw new AppError(
          `payload too large (${payloadSize} bytes > ${env.ANALYSIS_CACHE_MAX_PAYLOAD_BYTES} bytes)`,
          413
        )
      }

      const cache = AnalysisCache.upsert({
        cache_key: key,
        cache_version: meta.cache_version,
        brand_id: brandId,
        file_sha256: meta.file_sha256,
        model: meta.model,
        prompt_key: meta.prompt_key,
        prompt_hash: meta.prompt_hash,
        doc_type: meta.doc_type,
        reference_fingerprint: meta.reference_fingerprint,
        payload: sanitizedPayload,
        diagnostics_enabled: !!(env.ANALYSIS_CACHE_STORE_DIAGNOSTICS && meta.diagnostics_enabled),
        ttlDays: env.ANALYSIS_CACHE_TTL_DAYS
      })

      const prune = AnalysisCache.prune({ maxRows: env.ANALYSIS_CACHE_MAX_ROWS })
      res.json({ saved: true, cache, prune })
    } catch (err) {
      next(err)
    }
  },

  delete(req, res, next) {
    try {
      if (!env.ANALYSIS_CACHE_ENABLED) {
        return res.json({ deleted: 0, disabled: true })
      }

      const key = req.query.key
      validateKey(key)
      const deleted = AnalysisCache.deleteByKey(key)
      res.json({ deleted })
    } catch (err) {
      next(err)
    }
  },

  prune(req, res, next) {
    try {
      if (!env.ANALYSIS_CACHE_ENABLED) {
        return res.json({ disabled: true, prune: { expired_deleted: 0, lru_deleted: 0 } })
      }
      const maxRows = req.body?.max_rows
      const prune = AnalysisCache.prune({ maxRows })
      res.json({ prune })
    } catch (err) {
      next(err)
    }
  }
}
