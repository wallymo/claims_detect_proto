/**
 * Generate a correlation ID for request tracing
 * Format: timestamp-random (e.g., "1704067200000-a3f5b")
 */
export function generateCorrelationId() {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 7)
  return `${timestamp}-${random}`
}

/**
 * HTTP header name for correlation ID
 */
export const CORRELATION_ID_HEADER = 'X-Correlation-ID'
