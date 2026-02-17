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

/**
 * Extract text from a PDF with per-page boundaries.
 * Uses pdf-parse's pagerender hook to capture each page's text separately.
 * Returns fullText that is byte-for-byte identical to pdf-parse's default output.
 */
export async function extractTextByPage(filePath) {
  try {
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default
    const buffer = fs.readFileSync(filePath)

    const pages = []

    const pagerender = async (pageData) => {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false
      })
      let lastY
      let text = ''
      for (const item of textContent.items) {
        if (lastY === item.transform[5] || !lastY) {
          text += item.str
        } else {
          text += '\n' + item.str
        }
        lastY = item.transform[5]
      }
      pages.push(text)
      return text
    }

    const data = await pdfParse(buffer, { pagerender })
    const pageCount = data.numpages || null

    // pdf-parse output = '\n\n' + pages joined by '\n\n'
    // Use data.text directly to guarantee byte-for-byte parity
    const fullText = data.text || null

    // Build page boundary map from the captured per-page text
    // Account for the leading '\n\n' prefix that pdf-parse adds
    const pageBoundaries = []
    let cursor = 2 // skip leading '\n\n'
    for (let i = 0; i < pages.length; i++) {
      const pageText = pages[i]
      const startChar = cursor
      const endChar = cursor + pageText.length
      pageBoundaries.push({ page: i + 1, startChar, endChar })
      cursor = endChar + 2 // +2 for '\n\n' separator between pages
    }

    return { pages, pageCount, fullText, pageBoundaries }
  } catch (error) {
    console.error(`Page-aware extraction failed for ${filePath}:`, error.message)
    return { pages: [], pageCount: null, fullText: null, pageBoundaries: [] }
  }
}
