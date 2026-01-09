import fs from 'fs/promises'

// Accepted MIME types (DOCX/PPTX only - PDFs bypass normalizer)
const VALID_MIME_TYPES = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx'
}

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '100')
const MAX_PAGES = parseInt(process.env.MAX_PAGES || '200')

/**
 * Validate uploaded file meets requirements
 * @param {Object} file - Multer file object
 * @returns {Object} { valid: boolean, error?: string, fileType?: string }
 */
export async function validateFile(file) {
  if (!file) {
    return { valid: false, error: 'No file uploaded' }
  }

  // Check file size
  const fileSizeMB = file.size / (1024 * 1024)
  if (fileSizeMB > MAX_FILE_SIZE_MB) {
    return {
      valid: false,
      error: `File size ${fileSizeMB.toFixed(1)}MB exceeds ${MAX_FILE_SIZE_MB}MB limit`
    }
  }

  // Check MIME type
  const fileType = VALID_MIME_TYPES[file.mimetype]
  if (!fileType) {
    return {
      valid: false,
      error: `Unsupported file type: ${file.mimetype}. Only DOCX and PPTX are supported (PDFs don't need conversion).`
    }
  }

  // File passed validation
  return {
    valid: true,
    fileType
  }
}

/**
 * Get page count from PDF using pdfjs-dist
 * @param {string} pdfPath - Path to PDF file
 * @returns {Promise<number>} Page count
 */
export async function getPDFPageCount(pdfPath) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')

  const buffer = await fs.readFile(pdfPath)
  const data = new Uint8Array(buffer)
  const pdf = await pdfjsLib.getDocument({ data }).promise

  return pdf.numPages
}

/**
 * Validate page count doesn't exceed limits
 * @param {number} pageCount - Number of pages
 * @returns {Object} { valid: boolean, error?: string }
 */
export function validatePageCount(pageCount) {
  if (pageCount > MAX_PAGES) {
    return {
      valid: false,
      error: `Document has ${pageCount} pages, maximum is ${MAX_PAGES}`
    }
  }

  return { valid: true }
}
