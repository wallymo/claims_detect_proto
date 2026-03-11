import { Brand } from '../models/Brand.js'
import { Reference } from '../models/Reference.js'
import { AppError } from '../middleware/errorHandler.js'
import { matchingJobStore } from '../services/matchingJobStore.js'
import { matchAllClaimsToReferencesServer } from '../services/referenceMatchingService.js'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])
const SSE_HEARTBEAT_MS = 15_000

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function toClaimUpdate(claim) {
  if (!claim || !claim.id) return null

  return {
    id: claim.id,
    matched: !!claim.matched,
    matchConfidence: claim.matchConfidence,
    matchTier: claim.matchTier,
    reference: claim.reference || null,
    matchReasoning: claim.matchReasoning || null
  }
}

function normalizeClaims(inputClaims) {
  if (!Array.isArray(inputClaims) || inputClaims.length === 0) {
    throw new AppError('claims must be a non-empty array', 400)
  }

  return inputClaims.map((claim, index) => {
    const text = String(claim?.text || '').trim()
    if (!text) {
      throw new AppError(`claims[${index}].text is required`, 400)
    }

    return {
      ...claim,
      id: claim?.id || `claim-${index + 1}`,
      text
    }
  })
}

function normalizeReferences(brandId, inputReferences) {
  const brandReferences = Reference.findByBrand(brandId)
  const byId = new Map(brandReferences.map((ref) => [ref.id, ref]))

  if (!Array.isArray(inputReferences) || inputReferences.length === 0) {
    return brandReferences.map((ref) => ({
      id: ref.id,
      display_alias: ref.display_alias
    }))
  }

  const normalized = inputReferences
    .reduce((acc, ref) => {
      const id = parsePositiveInt(ref?.id)
      if (!id) return acc
      const row = byId.get(id)
      if (!row) return acc
      if (acc.seen.has(id)) return acc
      acc.seen.add(id)
      acc.items.push({
        id: row.id,
        display_alias: row.display_alias
      })
      return acc
    }, { seen: new Set(), items: [] })
    .items

  return normalized
}

function sanitizeOptions(inputOptions) {
  const options = inputOptions && typeof inputOptions === 'object' ? inputOptions : {}
  const normalized = {}

  const concurrency = parsePositiveInt(options.concurrency)
  if (concurrency) normalized.concurrency = concurrency

  const topK = parsePositiveInt(options.topK)
  if (topK) normalized.topK = topK

  const candidatePool = parsePositiveInt(options.candidatePool)
  if (candidatePool) normalized.candidatePool = candidatePool

  // Pass through pageReferences for citation-scoped matching (Tier 0)
  // Limit: max 200 pages, max 50 refs per section, max 500 chars per citation
  if (options.pageReferences && typeof options.pageReferences === 'object') {
    const sanitized = {}
    const pageKeys = Object.keys(options.pageReferences).slice(0, 200)
    for (const pageKey of pageKeys) {
      const sections = options.pageReferences[pageKey]
      if (!sections || typeof sections !== 'object') continue
      sanitized[pageKey] = {}
      for (const region of ['slide', 'notes']) {
        if (!sections[region] || typeof sections[region] !== 'object') continue
        const refs = {}
        const refKeys = Object.keys(sections[region]).slice(0, 50)
        for (const refKey of refKeys) {
          const val = sections[region][refKey]
          if (typeof val === 'string') {
            refs[refKey] = val.slice(0, 500)
          }
        }
        if (Object.keys(refs).length > 0) sanitized[pageKey][region] = refs
      }
    }
    if (Object.keys(sanitized).length > 0) normalized.pageReferences = sanitized
  }

  return normalized
}

export const matchingJobController = {
  create(req, res, next) {
    try {
      const brandId = parsePositiveInt(req.params.brandId)
      if (!brandId) throw new AppError('Invalid brandId', 400)

      const brand = Brand.findById(brandId)
      if (!brand) throw new AppError('Brand not found', 404)

      const claims = normalizeClaims(req.body?.claims)
      const references = normalizeReferences(brandId, req.body?.references)
      if (!references.length) {
        throw new AppError('No references available for matching', 400)
      }

      const options = sanitizeOptions(req.body?.options)
      let claimUpdateSeq = 0

      const job = matchingJobStore.create({
        run: async ({ updateProgress, isCancelled }) => {
          updateProgress({
            current: 0,
            total: claims.length,
            stage: 'queued'
          })

          return matchAllClaimsToReferencesServer(claims, references, brandId, {
            ...options,
            isCancelled,
            onProgress: ({ current, total, stage, claimIndex }) => {
              updateProgress({
                current,
                total,
                stage,
                claim_index: claimIndex || null
              })
            },
            onClaimResult: ({ current, total, claim, claimIndex }) => {
              const claimUpdate = toClaimUpdate(claim)
              if (!claimUpdate) return
              claimUpdateSeq += 1
              updateProgress({
                current,
                total,
                stage: 'done',
                claim_index: claimIndex || null,
                latest_claim_result_seq: claimUpdateSeq,
                latest_claim_result: claimUpdate
              })
            }
          })
        }
      })

      res.status(202).json({ job })
    } catch (err) {
      next(err)
    }
  },

  get(req, res, next) {
    try {
      const jobId = String(req.params.jobId || '').trim()
      if (!jobId) throw new AppError('jobId is required', 400)

      const job = matchingJobStore.get(jobId)
      if (!job) throw new AppError('Matching job not found', 404)
      res.json({ job })
    } catch (err) {
      next(err)
    }
  },

  events(req, res, next) {
    try {
      const jobId = String(req.params.jobId || '').trim()
      if (!jobId) throw new AppError('jobId is required', 400)

      const initialJob = matchingJobStore.get(jobId)
      if (!initialJob) throw new AppError('Matching job not found', 404)

      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders?.()

      let closed = false
      let unsubscribe = null
      let heartbeatHandle = null

      const cleanup = () => {
        if (closed) return
        closed = true
        if (heartbeatHandle) clearInterval(heartbeatHandle)
        if (unsubscribe) unsubscribe()
        if (!res.writableEnded) res.end()
      }

      const sendJob = (job) => {
        if (closed || !job) return
        res.write(`data: ${JSON.stringify({ job })}\n\n`)
        if (TERMINAL_STATUSES.has(job.status)) {
          cleanup()
        }
      }

      unsubscribe = matchingJobStore.subscribe(jobId, sendJob)
      if (!unsubscribe) {
        throw new AppError('Matching job not found', 404)
      }

      heartbeatHandle = setInterval(() => {
        if (closed || res.writableEnded) {
          cleanup()
          return
        }
        res.write(': keep-alive\n\n')
      }, SSE_HEARTBEAT_MS)

      req.on('close', cleanup)
    } catch (err) {
      next(err)
    }
  },

  cancel(req, res, next) {
    try {
      const jobId = String(req.params.jobId || '').trim()
      if (!jobId) throw new AppError('jobId is required', 400)

      const job = matchingJobStore.cancel(jobId)
      if (!job) throw new AppError('Matching job not found', 404)
      res.json({ job })
    } catch (err) {
      next(err)
    }
  }
}
