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
const envLevel = resolveLevel(viteEnv?.VITE_LOG_LEVEL || nodeEnv?.VITE_LOG_LEVEL)
const currentLevel = LEVELS[envLevel || defaultLevel] || LEVELS.info

const shouldLog = (level) => LEVELS[level] >= currentLevel

export const logger = {
  debug: (...args) => {
    if (shouldLog('debug')) console.debug(...args)
  },
  info: (...args) => {
    if (shouldLog('info')) console.info(...args)
  },
  warn: (...args) => {
    if (shouldLog('warn')) console.warn(...args)
  },
  error: (...args) => {
    if (shouldLog('error')) console.error(...args)
  }
}
