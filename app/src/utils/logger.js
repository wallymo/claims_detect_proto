const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50
}

const resolveLevel = (value) => {
  if (!value) return null
  const normalized = String(value).toLowerCase()
  return LEVELS[normalized] ? normalized : null
}

const viteEnv = typeof import.meta !== 'undefined' ? import.meta.env : undefined
const nodeEnv = typeof process !== 'undefined' ? process.env : undefined

const isDev = viteEnv?.DEV ?? (nodeEnv?.NODE_ENV === 'development')
const defaultLevel = isDev ? 'debug' : 'warn'
const envLevel = resolveLevel(viteEnv?.VITE_LOG_LEVEL || nodeEnv?.VITE_LOG_LEVEL || nodeEnv?.LOG_LEVEL)
const currentLevel = LEVELS[envLevel || defaultLevel] || LEVELS.info

// Log format: 'json' for production, 'pretty' for development
const logFormat = viteEnv?.VITE_LOG_FORMAT || nodeEnv?.LOG_FORMAT || (isDev ? 'pretty' : 'json')
const useJsonFormat = logFormat === 'json'

const shouldLog = (level) => LEVELS[level] >= currentLevel

// Correlation ID storage (request context)
let currentCorrelationId = null

/**
 * Format timestamp for log entries
 */
function formatTimestamp() {
  return new Date().toISOString()
}

/**
 * Format log entry as JSON or pretty print
 */
function formatLog(level, args, metadata = {}) {
  const timestamp = formatTimestamp()

  if (useJsonFormat) {
    // Structured JSON logging for production
    const logEntry = {
      timestamp,
      level,
      ...metadata
    }

    // Add correlation ID if present
    if (currentCorrelationId) {
      logEntry.correlationId = currentCorrelationId
    }

    // Handle different argument types
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !(args[0] instanceof Error)) {
      // Single object argument - merge into log entry
      Object.assign(logEntry, args[0])
    } else if (args.length === 1) {
      // Single primitive or Error - use as message
      logEntry.message = args[0] instanceof Error ? args[0].message : String(args[0])
      if (args[0] instanceof Error) {
        logEntry.stack = args[0].stack
      }
    } else {
      // Multiple arguments - first is message, rest are data
      logEntry.message = String(args[0])
      if (args.length > 1) {
        logEntry.data = args.slice(1).map(arg =>
          arg instanceof Error ? { message: arg.message, stack: arg.stack } : arg
        )
      }
    }

    return JSON.stringify(logEntry)
  } else {
    // Pretty format for development
    const correlationPrefix = currentCorrelationId ? `[${currentCorrelationId.slice(-8)}] ` : ''
    return [`[${timestamp}] ${correlationPrefix}`, ...args]
  }
}

/**
 * Output log to console
 */
function output(level, formattedLog) {
  if (useJsonFormat) {
    // Always use console.log for JSON to avoid browser formatting
    console.log(formattedLog)
  } else {
    // Use appropriate console method for pretty printing
    switch (level) {
      case 'debug':
        console.debug(...formattedLog)
        break
      case 'info':
        console.info(...formattedLog)
        break
      case 'warn':
        console.warn(...formattedLog)
        break
      case 'error':
        console.error(...formattedLog)
        break
      default:
        console.log(...formattedLog)
    }
  }
}

export const logger = {
  debug: (...args) => {
    if (shouldLog('debug')) {
      const formatted = formatLog('debug', args)
      output('debug', formatted)
    }
  },
  info: (...args) => {
    if (shouldLog('info')) {
      const formatted = formatLog('info', args)
      output('info', formatted)
    }
  },
  warn: (...args) => {
    if (shouldLog('warn')) {
      const formatted = formatLog('warn', args)
      output('warn', formatted)
    }
  },
  error: (...args) => {
    if (shouldLog('error')) {
      const formatted = formatLog('error', args)
      output('error', formatted)
    }
  },

  /**
   * Set correlation ID for request tracking
   * @param {string} id - Correlation ID to track related logs
   */
  setCorrelationId: (id) => {
    currentCorrelationId = id
  },

  /**
   * Clear correlation ID
   */
  clearCorrelationId: () => {
    currentCorrelationId = null
  },

  /**
   * Get current correlation ID
   */
  getCorrelationId: () => {
    return currentCorrelationId
  }
}
