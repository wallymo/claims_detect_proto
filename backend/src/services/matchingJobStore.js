import crypto from 'crypto'
import { EventEmitter } from 'events'

const MAX_JOBS = 100
const JOB_RETENTION_MS = 6 * 60 * 60 * 1000 // 6 hours

const jobs = new Map()
const jobEvents = new EventEmitter()
jobEvents.setMaxListeners(0)

function nowIso() {
  return new Date().toISOString()
}

function makeJobId() {
  return crypto.randomUUID()
}

function isTerminal(status) {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function eventName(jobId) {
  return `job:${jobId}`
}

function emitJobUpdate(jobId) {
  const next = snapshot(jobs.get(jobId))
  if (!next) return
  jobEvents.emit(eventName(jobId), next)
}

function pruneJobs() {
  const now = Date.now()
  for (const [jobId, job] of jobs.entries()) {
    const updatedAt = Date.parse(job.updated_at || job.created_at || nowIso())
    if (isTerminal(job.status) && Number.isFinite(updatedAt) && now - updatedAt > JOB_RETENTION_MS) {
      jobs.delete(jobId)
    }
  }

  if (jobs.size <= MAX_JOBS) return

  const sorted = [...jobs.entries()].sort((a, b) => {
    const aTs = Date.parse(a[1].updated_at || a[1].created_at || '')
    const bTs = Date.parse(b[1].updated_at || b[1].created_at || '')
    return (Number.isFinite(aTs) ? aTs : 0) - (Number.isFinite(bTs) ? bTs : 0)
  })

  while (jobs.size > MAX_JOBS && sorted.length > 0) {
    const [oldestId] = sorted.shift()
    jobs.delete(oldestId)
  }
}

function setJob(jobId, patch) {
  const existing = jobs.get(jobId)
  if (!existing) return null

  const next = {
    ...existing,
    ...patch,
    updated_at: nowIso()
  }
  jobs.set(jobId, next)
  emitJobUpdate(jobId)
  return next
}

function snapshot(job) {
  if (!job) return null
  return {
    job_id: job.job_id,
    status: job.status,
    created_at: job.created_at,
    updated_at: job.updated_at,
    progress: job.progress || null,
    error: job.error || null,
    result: job.status === 'completed' ? job.result : null
  }
}

export const matchingJobStore = {
  create({ run }) {
    pruneJobs()

    const jobId = makeJobId()
    const createdAt = nowIso()
    jobs.set(jobId, {
      job_id: jobId,
      status: 'queued',
      created_at: createdAt,
      updated_at: createdAt,
      progress: { current: 0, total: 0, stage: 'queued' },
      cancelled: false,
      error: null,
      result: null
    })
    emitJobUpdate(jobId)

    void (async () => {
      const started = setJob(jobId, {
        status: 'running',
        progress: { current: 0, total: 0, stage: 'running' }
      })
      if (!started || started.cancelled) return

      try {
        const result = await run({
          jobId,
          updateProgress: (progressPatch) => {
            if (!jobs.has(jobId)) return
            const currentJob = jobs.get(jobId)
            if (!currentJob || currentJob.cancelled) return

            const nextProgress = {
              ...(currentJob.progress || { current: 0, total: 0, stage: 'running' }),
              ...(progressPatch || {})
            }
            setJob(jobId, { progress: nextProgress })
          },
          isCancelled: () => {
            const currentJob = jobs.get(jobId)
            return !currentJob || currentJob.cancelled
          }
        })

        const currentJob = jobs.get(jobId)
        if (!currentJob || currentJob.cancelled) {
          setJob(jobId, { status: 'cancelled', error: 'Cancelled by user' })
          return
        }

        setJob(jobId, {
          status: 'completed',
          result,
          progress: {
            ...(currentJob.progress || {}),
            stage: 'done'
          }
        })
      } catch (error) {
        const currentJob = jobs.get(jobId)
        if (!currentJob) return
        if (currentJob.cancelled) {
          setJob(jobId, { status: 'cancelled', error: 'Cancelled by user' })
          return
        }
        setJob(jobId, {
          status: 'failed',
          error: String(error?.message || error || 'Matching job failed')
        })
      } finally {
        pruneJobs()
      }
    })()

    return snapshot(jobs.get(jobId))
  },

  get(jobId) {
    return snapshot(jobs.get(jobId))
  },

  cancel(jobId) {
    const current = jobs.get(jobId)
    if (!current) return null

    if (isTerminal(current.status)) {
      return snapshot(current)
    }

    const next = setJob(jobId, {
      cancelled: true,
      status: 'cancelled',
      error: 'Cancelled by user'
    })
    return snapshot(next)
  },

  subscribe(jobId, listener) {
    if (!jobs.has(jobId) || typeof listener !== 'function') return null
    const key = eventName(jobId)
    const handler = (jobSnapshot) => {
      listener(jobSnapshot)
    }

    jobEvents.on(key, handler)
    queueMicrotask(() => {
      const current = snapshot(jobs.get(jobId))
      if (current) listener(current)
    })

    return () => {
      jobEvents.off(key, handler)
    }
  }
}
