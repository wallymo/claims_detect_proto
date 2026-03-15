function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

export const env = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DB_PATH: process.env.DB_PATH || './data/claims_detector.db',
  UPLOAD_DIR: process.env.UPLOAD_DIR || './uploads',
  MAX_FILE_SIZE_MB: parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10),
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  ANALYSIS_CACHE_ENABLED: parseBooleanEnv(process.env.ANALYSIS_CACHE_ENABLED, true),
  ANALYSIS_CACHE_TTL_DAYS: parseInt(process.env.ANALYSIS_CACHE_TTL_DAYS || '30', 10),
  ANALYSIS_CACHE_MAX_ROWS: parseInt(process.env.ANALYSIS_CACHE_MAX_ROWS || '500', 10),
  ANALYSIS_CACHE_STORE_DIAGNOSTICS: parseBooleanEnv(process.env.ANALYSIS_CACHE_STORE_DIAGNOSTICS, false),
  ANALYSIS_CACHE_MAX_PAYLOAD_BYTES: parseInt(process.env.ANALYSIS_CACHE_MAX_PAYLOAD_BYTES || '3000000', 10),
  DOCUMENT_AI_ENABLED: parseBooleanEnv(process.env.DOCUMENT_AI_ENABLED, false),
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT || '',
  DOCUMENT_AI_LOCATION: process.env.DOCUMENT_AI_LOCATION || 'us',
  DOCUMENT_AI_PROCESSOR_ID: process.env.DOCUMENT_AI_PROCESSOR_ID || ''
}
