import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger } from '../../src/utils/logger.js'

describe('logger', () => {
  let consoleSpies

  beforeEach(() => {
    consoleSpies = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      log: vi.spyOn(console, 'log').mockImplementation(() => {})
    }
  })

  afterEach(() => {
    Object.values(consoleSpies).forEach(spy => spy.mockRestore())
    logger.clearCorrelationId()
  })

  describe('debug', () => {
    it('should call console.debug with arguments', () => {
      logger.debug('test message', { data: 'value' })
      expect(consoleSpies.debug).toHaveBeenCalled()
    })

    it('should handle multiple arguments', () => {
      logger.debug('msg1', 'msg2', 'msg3')
      expect(consoleSpies.debug).toHaveBeenCalled()
    })
  })

  describe('info', () => {
    it('should call console.info with arguments', () => {
      logger.info('info message')
      expect(consoleSpies.info).toHaveBeenCalled()
    })
  })

  describe('warn', () => {
    it('should call console.warn with arguments', () => {
      logger.warn('warning message')
      expect(consoleSpies.warn).toHaveBeenCalled()
    })
  })

  describe('error', () => {
    it('should call console.error with arguments', () => {
      logger.error('error message', new Error('test'))
      expect(consoleSpies.error).toHaveBeenCalled()
    })
  })

  describe('correlation ID', () => {
    it('should set and get correlation ID', () => {
      expect(logger.getCorrelationId()).toBeNull()

      logger.setCorrelationId('test-123')
      expect(logger.getCorrelationId()).toBe('test-123')
    })

    it('should clear correlation ID', () => {
      logger.setCorrelationId('test-456')
      logger.clearCorrelationId()
      expect(logger.getCorrelationId()).toBeNull()
    })
  })
})
