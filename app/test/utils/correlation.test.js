import { describe, it, expect } from 'vitest'
import { generateCorrelationId, CORRELATION_ID_HEADER } from '../../src/utils/correlation.js'

describe('correlation', () => {
  describe('generateCorrelationId', () => {
    it('should generate a unique correlation ID', () => {
      const id1 = generateCorrelationId()
      const id2 = generateCorrelationId()

      expect(id1).toBeDefined()
      expect(id2).toBeDefined()
      expect(id1).not.toBe(id2)
    })

    it('should follow timestamp-random format', () => {
      const id = generateCorrelationId()
      const parts = id.split('-')

      expect(parts).toHaveLength(2)
      expect(Number(parts[0])).toBeGreaterThan(0)
      expect(parts[1].length).toBe(5)
    })

    it('should include timestamp', () => {
      const before = Date.now()
      const id = generateCorrelationId()
      const after = Date.now()

      const timestamp = Number(id.split('-')[0])
      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('CORRELATION_ID_HEADER', () => {
    it('should be the correct header name', () => {
      expect(CORRELATION_ID_HEADER).toBe('X-Correlation-ID')
    })
  })
})
