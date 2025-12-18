/**
 * Extract text content with positions from all pages of a PDF.
 * Positions are in PDF coordinate space (origin bottom-left) but we flip Y to screen coordinates (origin top-left).
 * Additionally, we group nearby items into line boxes to improve downstream matching and bounding boxes.
 */

function normalizeForGrouping(str) {
  return str.replace(/\s+/g, ' ').trim()
}

export async function extractTextWithPositions(pdf) {
  const pages = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, i) => {
      const page = await pdf.getPage(i + 1)
      const textContent = await page.getTextContent()
      const viewport = page.getViewport({ scale: 1 })

      const items = textContent.items.map(item => ({
        str: item.str,
        // PDF coordinates: origin at bottom-left
        // Screen coordinates: origin at top-left, so flip Y
        x: item.transform[4],
        y: viewport.height - item.transform[5],
        width: item.width || 0,
        height: item.height || 12
      }))

      // Group items into lines based on Y overlap/tolerance
      const lines = []
      const yTolerance = 4 // pixels; PDF.js text items vary slightly per glyph

      items.forEach((item, index) => {
        const line = lines.find(l => Math.abs(l.y - item.y) <= yTolerance)
        if (line) {
          line.items.push({ ...item, index })
          line.y = Math.min(line.y, item.y)
          line.height = Math.max(line.height, item.height)
          line.xMin = Math.min(line.xMin, item.x)
          line.xMax = Math.max(line.xMax, item.x + item.width)
        } else {
          lines.push({
            items: [{ ...item, index }],
            y: item.y,
            height: item.height,
            xMin: item.x,
            xMax: item.x + item.width
          })
        }
      })

      // Finalize line boxes and text
      const finalizedLines = lines.map(line => {
        const text = normalizeForGrouping(line.items.map(it => it.str).join(' '))
        const x = line.xMin
        const width = line.xMax - line.xMin
        return {
          text,
          x,
          y: line.y,
          width,
          height: line.height,
          itemIndices: line.items.map(it => it.index)
        }
      })

      return {
        pageNum: i + 1,
        width: viewport.width,
        height: viewport.height,
        items,
        lines: finalizedLines
      }
    })
  )
  return pages
}
