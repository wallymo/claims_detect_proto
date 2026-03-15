/**
 * Extract text content with positions from all pages of a PDF.
 * Positions are in PDF coordinate space (origin bottom-left) but we flip Y to screen coordinates (origin top-left).
 * Additionally, we group nearby items into line boxes to improve downstream matching and bounding boxes.
 */

function normalizeForGrouping(str) {
  return str.replace(/\s+/g, ' ').trim()
}

function buildLineCluster(items) {
  const sortedItems = [...items].sort((a, b) => a.x - b.x)
  const xMin = Math.min(...sortedItems.map(item => item.x))
  const xMax = Math.max(...sortedItems.map(item => item.x + item.width))
  const y = Math.min(...sortedItems.map(item => item.y))
  const height = Math.max(...sortedItems.map(item => item.height))

  return {
    text: normalizeForGrouping(sortedItems.map(item => item.str).join(' ')),
    x: xMin,
    y,
    width: xMax - xMin,
    height,
    itemIndices: sortedItems.map(item => item.index)
  }
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

      // Group items into rows based on Y overlap/tolerance, then split large X gaps
      // into separate clusters so multi-column/table layouts do not collapse into one line.
      const sortedItems = items
        .map((item, index) => ({ ...item, index }))
        .sort((a, b) => {
          const yDiff = a.y - b.y
          return Math.abs(yDiff) <= 4 ? a.x - b.x : yDiff
        })

      const rows = []
      const yTolerance = 4 // pixels; PDF.js text items vary slightly per glyph

      sortedItems.forEach((item) => {
        const row = rows.find(r => Math.abs(r.y - item.y) <= yTolerance)
        if (row) {
          row.items.push(item)
          row.y = Math.min(row.y, item.y)
        } else {
          rows.push({
            items: [item],
            y: item.y,
          })
        }
      })

      const finalizedLines = rows
        .flatMap((row) => {
          const rowItems = [...row.items].sort((a, b) => a.x - b.x)
          const clusters = []

          rowItems.forEach((item) => {
            const current = clusters[clusters.length - 1]
            if (!current) {
              clusters.push([item])
              return
            }

            const previous = current[current.length - 1]
            const prevRight = previous.x + (previous.width || 0)
            const gap = item.x - prevRight
            const gapThreshold = Math.max(14, Math.min(40, Math.max(previous.height || 12, item.height || 12) * 1.6))

            if (gap > gapThreshold) {
              clusters.push([item])
              return
            }

            current.push(item)
          })

          return clusters.map(cluster => buildLineCluster(cluster))
        }
        )
        .sort((a, b) => {
          const yDiff = a.y - b.y
          return Math.abs(yDiff) <= yTolerance ? a.x - b.x : yDiff
        })

      const notesHeader = finalizedLines.find(line => /^speaker\s+notes?\s*$/i.test(line.text))
      const notesBoundaryY = notesHeader ? Math.max(0, notesHeader.y - notesHeader.height) : null

      return {
        pageNum: i + 1,
        width: viewport.width,
        height: viewport.height,
        items,
        lines: finalizedLines,
        notesBoundaryY
      }
    })
  )
  return pages
}
