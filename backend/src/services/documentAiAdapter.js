/**
 * Convert a Document AI response into the same page/line shape
 * produced by the frontend's extractPageTextLines().
 *
 * Output per page:
 *   { pageNum, notesBoundaryY, hasSpeakerNotes, lines: [{ text, y, x, maxX, refs }] }
 *
 * Coordinates are 0-100 percentages with top-left origin (matching pdf.js convention).
 */

// ── Minimal citation-ref parsing (mirrors frontend citationRefParsing.js) ────

const SUPER_DIGIT_MAP = {
  '\u2070': 0, '\u00b9': 1, '\u00b2': 2, '\u00b3': 3,
  '\u2074': 4, '\u2075': 5, '\u2076': 6, '\u2077': 7,
  '\u2078': 8, '\u2079': 9
}

const SUPER_DIGITS = Object.keys(SUPER_DIGIT_MAP).join('')

function parseNumericRefs(text) {
  const cleaned = String(text || '')
    .replace(/[\s,\u00b7\xb7]+/g, ',')
    .replace(/^,|,$/g, '')
  if (!cleaned) return []
  return cleaned
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n) && n > 0 && n < 200)
}

function parseSuperscriptChars(text) {
  const re = new RegExp(`[${SUPER_DIGITS}]+`, 'g')
  const refs = []
  let match
  while ((match = re.exec(text)) !== null) {
    const digits = [...match[0]]
      .map(ch => SUPER_DIGIT_MAP[ch])
      .filter(d => d !== undefined)
    if (digits.length > 0) {
      const num = parseInt(digits.join(''), 10)
      if (num > 0 && num < 200) refs.push(num)
    }
  }
  return refs
}

function extractTrailingRefs(text) {
  const match = String(text || '').match(/[\d,\s]+$/)
  if (!match) return []
  return parseNumericRefs(match[0])
}

// ── Document AI helpers ─────────────────────────────────────────────────────

function extractTextFromAnchor(fullText, textAnchor) {
  if (!textAnchor?.textSegments?.length) return ''
  return textAnchor.textSegments
    .map(seg => fullText.substring(Number(seg.startIndex) || 0, Number(seg.endIndex) || 0))
    .join('')
    .trim()
}

function getBox(boundingPoly) {
  const vertices = boundingPoly?.normalizedVertices
  if (!vertices?.length) return null
  const xs = vertices.map(v => (v.x || 0) * 100)
  const ys = vertices.map(v => (v.y || 0) * 100)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
    height: Math.max(...ys) - Math.min(...ys)
  }
}

// ── Main conversion ─────────────────────────────────────────────────────────

export function convertDocumentToPages(document) {
  if (!document?.pages?.length) return []

  const fullText = document.text || ''
  const pages = []

  for (let i = 0; i < document.pages.length; i++) {
    const page = document.pages[i]
    const pageNum = i + 1

    // ── Token-level superscript detection (analogous to font-size comparison) ──
    const tokens = (page.tokens || [])
      .map(token => ({
        text: extractTextFromAnchor(fullText, token.layout?.textAnchor),
        box: getBox(token.layout?.boundingPoly)
      }))
      .filter(t => t.text && t.box)

    // Dominant token height (mode)
    const tokenHeights = tokens
      .filter(t => t.box.height > 0.1)
      .map(t => Math.round(t.box.height * 10) / 10)
    const heightFreq = {}
    for (const h of tokenHeights) heightFreq[h] = (heightFreq[h] || 0) + 1
    const dominantHeight = Number(
      Object.entries(heightFreq).sort((a, b) => b[1] - a[1])[0]?.[0]
    ) || 3
    const superThreshold = dominantHeight * 0.7

    // Tokens that look like superscript reference numbers
    const superTokens = tokens.filter(t =>
      t.box.height > 0 &&
      t.box.height < superThreshold &&
      /^[\d,.\u00b7\xb7\u2070\u00b9\u00b2\u00b3\u2074-\u2079]+$/.test(t.text.trim())
    )

    // ── Extract lines ──
    const docAiLines = (page.lines || [])
      .map(line => {
        const text = extractTextFromAnchor(fullText, line.layout?.textAnchor)
        const box = getBox(line.layout?.boundingPoly)
        if (!text || !box) return null

        // Associate superscript tokens that overlap this line vertically
        const yMin = box.y - 1
        const yMax = box.maxY + 1
        const lineSuperTokens = superTokens.filter(st =>
          st.box.y >= yMin && st.box.y <= yMax &&
          st.box.x >= box.x - 5 && st.box.x <= box.maxX + 20
        )

        // Collect ref numbers: token-based + text-based
        const refs = new Set()
        for (const st of lineSuperTokens) {
          parseNumericRefs(st.text).forEach(r => refs.add(r))
        }
        extractTrailingRefs(text).forEach(r => refs.add(r))
        parseSuperscriptChars(text).forEach(r => refs.add(r))

        return {
          text: text.replace(/\s+/g, ' ').trim(),
          y: Math.round(box.y * 10) / 10,
          x: Math.round(box.x * 10) / 10,
          maxX: Math.round(box.maxX * 10) / 10,
          refs: [...refs].sort((a, b) => a - b)
        }
      })
      .filter(Boolean)

    // ── Detect Speaker Notes boundary ──
    let notesBoundaryY = null
    let hasSpeakerNotes = false
    for (const line of docAiLines) {
      if (/^speaker\s+notes?\s*$/i.test(line.text)) {
        notesBoundaryY = line.y
        hasSpeakerNotes = true
        break
      }
    }

    pages.push({
      pageNum,
      notesBoundaryY,
      hasSpeakerNotes,
      lines: docAiLines.filter(l => l.text.length > 2)
    })
  }

  return pages
}
