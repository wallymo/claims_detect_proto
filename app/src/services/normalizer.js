/**
 * Document Normalizer Service
 *
 * Handles communication with backend normalizer service to convert
 * DOCX/PPTX/PDF → canonical PDF + page images
 */

import { logger } from '@/utils/logger'

const NORMALIZER_API = import.meta.env.VITE_NORMALIZER_URL || 'http://localhost:3001'

/**
 * Normalize a document to canonical PDF format
 * @param {File} file - PDF, DOCX, or PPTX file
 * @param {Function} onProgress - Progress callback (progress: 0-100, status: string)
 * @returns {Promise<Object>} { success: boolean, document?: NormalizedDocument, error?: string }
 */
export async function normalizeDocument(file, onProgress) {
  onProgress?.(5, 'Validating document...')

  const formData = new FormData()
  formData.append('file', file)

  onProgress?.(10, 'Uploading to normalizer...')

  try {
    const response = await fetch(`${NORMALIZER_API}/normalize`, {
      method: 'POST',
      body: formData
    })

    // DEBUG: Log raw response status
    logger.debug(`Normalizer response: status=${response.status}, ok=${response.ok}`)

    // Get raw text first to see what backend returned
    const rawText = await response.text()
    logger.debug(`Normalizer raw response (first 500 chars):`, rawText?.substring(0, 500))

    // Try to parse as JSON
    let result
    try {
      result = JSON.parse(rawText)
    } catch (parseError) {
      logger.error('Normalizer JSON parse failed:', parseError.message)
      logger.error('Normalizer raw response:', rawText?.substring(0, 1000))
      throw new Error(`Backend returned invalid JSON: ${parseError.message}`)
    }

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Document normalization failed')
    }

    onProgress?.(20, 'Document normalized')

    return result
  } catch (error) {
    logger.error('Normalization error:', error)
    throw new Error(error.message || 'Failed to connect to normalizer service')
  }
}

/**
 * Convert base64 data URL to Blob for AI analysis
 * @param {string} dataURL - Base64 data URL (e.g., "data:application/pdf;base64,...")
 * @returns {Blob} Blob object
 */
export function base64ToBlob(dataURL) {
  const [header, base64] = dataURL.split(',')
  const mimeMatch = header.match(/:(.*?);/)
  const mime = mimeMatch ? mimeMatch[1] : 'application/pdf'

  const binary = atob(base64)
  const array = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i)
  }

  return new Blob([array], { type: mime })
}

/**
 * Check if normalizer service is available
 * @returns {Promise<boolean>}
 */
export async function checkNormalizerHealth() {
  try {
    const response = await fetch(`${NORMALIZER_API}/health`)
    const data = await response.json()
    return data.status === 'ok'
  } catch (error) {
    logger.error('Normalizer health check failed:', error)
    return false
  }
}
