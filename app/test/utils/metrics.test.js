import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { metrics, trackAICall, trackDocumentProcessing } from '../../src/utils/metrics.js'

describe('metrics', () => {
  let consoleSpies

  beforeEach(() => {
    consoleSpies = {
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      log: vi.spyOn(console, 'log').mockImplementation(() => {})
    }
  })

  afterEach(() => {
    Object.values(consoleSpies).forEach(spy => spy.mockRestore())
  })

  describe('PerformanceTracker', () => {
    it('should start and end a timer', () => {
      const timerId = metrics.start('test-operation')
      expect(timerId).toBeDefined()

      const duration = metrics.end(timerId)
      expect(duration).toBeGreaterThanOrEqual(0)
    })

    it('should return null for unknown timer', () => {
      const duration = metrics.end('unknown-timer')
      expect(duration).toBeNull()
    })

    it('should include metadata in logs', () => {
      const timerId = metrics.start('test-op', { key: 'value' })
      metrics.end(timerId, { extra: 'data' })

      // Logger should have been called
      expect(consoleSpies.info).toHaveBeenCalled()
    })

    it('should measure async operations', async () => {
      const result = await metrics.measure('async-op', async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return 'done'
      })

      expect(result).toBe('done')
    })

    it('should handle errors in measured operations', async () => {
      await expect(
        metrics.measure('failing-op', async () => {
          throw new Error('Test error')
        })
      ).rejects.toThrow('Test error')
    })
  })

  describe('trackAICall', () => {
    it('should track AI calls with provider metadata', async () => {
      const result = await trackAICall('gemini', 'analyze', async () => {
        return { success: true }
      }, { fileSize: 1024 })

      expect(result).toEqual({ success: true })
    })
  })

  describe('trackDocumentProcessing', () => {
    it('should track document processing', async () => {
      const result = await trackDocumentProcessing('convert', async () => {
        return { pageCount: 5 }
      })

      expect(result).toEqual({ pageCount: 5 })
    })
  })
})
