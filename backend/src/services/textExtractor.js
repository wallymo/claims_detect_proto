import fs from 'fs'

export async function extractText(filePath, docType) {
  try {
    if (docType === 'pdf') {
      const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default
      const buffer = fs.readFileSync(filePath)
      const data = await pdfParse(buffer)
      return {
        text: data.text || null,
        pageCount: data.numpages || null
      }
    }

    if (docType === 'docx' || docType === 'doc') {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ path: filePath })
      return {
        text: result.value || null,
        pageCount: null
      }
    }

    return { text: null, pageCount: null }
  } catch (error) {
    console.error(`Text extraction failed for ${filePath}:`, error.message)
    return { text: null, pageCount: null }
  }
}
