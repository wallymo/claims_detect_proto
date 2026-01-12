import { expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock environment variables
vi.stubEnv('VITE_GEMINI_API_KEY', 'test-gemini-key')
vi.stubEnv('VITE_OPENAI_API_KEY', 'test-openai-key')
vi.stubEnv('VITE_ANTHROPIC_API_KEY', 'test-anthropic-key')
vi.stubEnv('VITE_NORMALIZER_URL', 'http://localhost:3001')

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock navigator.clipboard
Object.defineProperty(navigator, 'clipboard', {
  writable: true,
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
})

// Mock performance.now for metrics
if (typeof performance === 'undefined') {
  global.performance = {
    now: vi.fn(() => Date.now())
  }
}
