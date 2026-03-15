import { DocumentProcessorServiceClient } from '@google-cloud/documentai'
import { env } from '../config/env.js'

let client = null

function getClient() {
  if (!client) {
    client = new DocumentProcessorServiceClient()
  }
  return client
}

/**
 * Send a PDF buffer to Google Document AI for OCR extraction.
 * Returns the Document AI `document` object with pages, text, tokens, lines.
 */
export async function processDocument(pdfBuffer) {
  if (!env.DOCUMENT_AI_ENABLED) {
    throw new Error('Document AI is not enabled. Set DOCUMENT_AI_ENABLED=true')
  }

  const name = `projects/${env.GOOGLE_CLOUD_PROJECT}/locations/${env.DOCUMENT_AI_LOCATION}/processors/${env.DOCUMENT_AI_PROCESSOR_ID}`

  const request = {
    name,
    rawDocument: {
      content: pdfBuffer.toString('base64'),
      mimeType: 'application/pdf'
    }
  }

  const [result] = await getClient().processDocument(request)
  return result.document
}
