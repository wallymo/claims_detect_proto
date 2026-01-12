import { logger } from './logger.js'

/**
 * Performance tracker for monitoring operation durations
 */
class PerformanceTracker {
  constructor() {
    this.timers = new Map()
  }

  /**
   * Start timing an operation
   * @param {string} operationName - Name of the operation
   * @param {Object} metadata - Additional metadata to log
   * @returns {string} - Timer ID
   */
  start(operationName, metadata = {}) {
    const timerId = `${operationName}-${Date.now()}-${Math.random().toString(36).substring(7)}`
    this.timers.set(timerId, {
      operationName,
      startTime: performance.now(),
      metadata
    })
    return timerId
  }

  /**
   * End timing an operation and log the duration
   * @param {string} timerId - Timer ID returned from start()
   * @param {Object} additionalMetadata - Additional metadata to log
   */
  end(timerId, additionalMetadata = {}) {
    const timer = this.timers.get(timerId)
    if (!timer) {
      logger.warn(`Timer ${timerId} not found`)
      return null
    }

    const endTime = performance.now()
    const duration = endTime - timer.startTime

    const logData = {
      operation: timer.operationName,
      durationMs: Math.round(duration),
      ...timer.metadata,
      ...additionalMetadata
    }

    logger.info('Performance metric', logData)

    this.timers.delete(timerId)
    return duration
  }

  /**
   * Measure an async operation
   * @param {string} operationName - Name of the operation
   * @param {Function} fn - Async function to measure
   * @param {Object} metadata - Additional metadata
   * @returns {Promise} - Result of the function
   */
  async measure(operationName, fn, metadata = {}) {
    const timerId = this.start(operationName, metadata)
    try {
      const result = await fn()
      this.end(timerId, { success: true })
      return result
    } catch (error) {
      this.end(timerId, { success: false, error: error.message })
      throw error
    }
  }
}

// Singleton instance
export const metrics = new PerformanceTracker()

/**
 * Track AI API call performance
 */
export async function trackAICall(provider, operation, fn, metadata = {}) {
  return metrics.measure(
    `ai.${provider}.${operation}`,
    fn,
    { provider, ...metadata }
  )
}

/**
 * Track document processing performance
 */
export async function trackDocumentProcessing(operation, fn, metadata = {}) {
  return metrics.measure(
    `document.${operation}`,
    fn,
    metadata
  )
}
