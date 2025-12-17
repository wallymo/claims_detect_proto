/**
 * Extract text content with positions from all pages of a PDF
 * Positions are in PDF coordinate space (origin bottom-left)
 * We flip Y to screen coordinates (origin top-left)
 */

export async function extractTextWithPositions(pdf) {
  const pages = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, i) => {
      const page = await pdf.getPage(i + 1)
      const textContent = await page.getTextContent()
      const viewport = page.getViewport({ scale: 1 })

      return {
        pageNum: i + 1,
        width: viewport.width,
        height: viewport.height,
        items: textContent.items.map(item => ({
          str: item.str,
          // PDF coordinates: origin at bottom-left
          // Screen coordinates: origin at top-left, so flip Y
          x: item.transform[4],
          y: viewport.height - item.transform[5],
          width: item.width || 0,
          height: item.height || 12
        }))
      }
    })
  )
  return pages
}
