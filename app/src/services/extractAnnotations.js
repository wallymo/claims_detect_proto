/**
 * Deterministic Annotation Pipeline for MKG3
 *
 * Extracts on-page references and maps them to content using pdf.js text layer.
 * Primary path is deterministic. Gemini Vision is used as a fallback for pages
 * where the text layer has reference footnotes but no superscripts (image-only slides).
 *
 * Pipeline: extractPageTextLines() → parseTextAnnotations()
 *           → [Gemini Vision for orphan pages] → buildTextOnlyAnnotations()
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfjsWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { logger } from '@/utils/logger'
import {
  SUPER_CHAR_PATTERN,
  extractTrailingCitationRefs,
  parseNumericCitationRefs,
  parseSuperscriptCitationRefs
} from '@/utils/citationRefParsing'
import { collectFullStatement, looksLikeShortHeading } from '@/utils/statementAssembly'
import { buildTextOnlyAnnotations } from '@/utils/textOnlyAnnotations'
import { detectSlideSuperscripts } from '@/services/gemini'

// Ensure pdf.js worker is configured (idempotent)
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl
}

const SUPER_CHARS = SUPER_CHAR_PATTERN

function stripSuperscripts(text) {
  return text.replace(new RegExp(`[${SUPER_CHARS}\\u00b7·,]+$`, 'g'), '').trim()
}

function isSameColumn(lineA, lineB) {
  const aMaxX = lineA.maxX ?? lineA.x + 15
  const bMaxX = lineB.maxX ?? lineB.x + 15
  const overlapStart = Math.max(lineA.x, lineB.x)
  const overlapEnd = Math.min(aMaxX, bMaxX)
  return overlapEnd - overlapStart > -4
}

function extractInlineNumberedReferences(text) {
  const source = String(text || '').replace(/\s+/g, ' ').trim()
  if (!source) return []

  const matches = [...source.matchAll(/(?:^|\s)(\d{1,2})[.)]\s+/g)]
  if (matches.length === 0) return []

  return matches.map((match, index) => {
    const prefixLength = match[0].startsWith(' ') ? 1 : 0
    const start = (match.index ?? 0) + prefixLength
    const contentStart = start + match[0].trimStart().length
    const nextStart = index < matches.length - 1
      ? (matches[index + 1].index ?? source.length) + (matches[index + 1][0].startsWith(' ') ? 1 : 0)
      : source.length

    return {
      number: match[1],
      text: source.slice(contentStart, nextStart).trim(),
      start
    }
  }).filter(entry => entry.text)
}

// ─── Step 1: PDF Text Extraction ──────────────────────────────────────────────

async function extractPageTextLines(pdfFile) {
  const arrayBuffer = await pdfFile.arrayBuffer()
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pages = []

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum)
    const viewport = page.getViewport({ scale: 1.0 })
    const textContent = await page.getTextContent()

    const items = []
    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue
      const tx = item.transform
      // pdf.js transform: [scaleX, skewX, skewY, scaleY, translateX, translateY]
      const x = (tx[4] / viewport.width) * 100
      // pdf.js Y is bottom-up — convert to top-down percentage
      const y = ((viewport.height - tx[5]) / viewport.height) * 100
      const fontSize = Math.abs(tx[3])
      items.push({ text: item.str, x, y, fontSize })
    }

    // Dominant body font size (mode of fonts >= 8pt)
    const bodyFonts = items.filter(i => i.fontSize >= 8).map(i => Math.round(i.fontSize))
    const fontFreq = {}
    for (const f of bodyFonts) fontFreq[f] = (fontFreq[f] || 0) + 1
    const bodyFontSize = Number(Object.entries(fontFreq).sort((a, b) => b[1] - a[1])[0]?.[0]) || 11
    const superThreshold = bodyFontSize * 0.7

    // Classify: body vs superscript. Includes Unicode superscript digits (Fix B).
    const isSuper = (item) =>
      item.fontSize <= superThreshold &&
      /^(?:[\d,.\u00b7·\u2070\u00b9\u00b2\u00b3\u2074-\u2079]+)$/.test(item.text.trim()) &&
      !/^\d+\.$/.test(item.text.trim())

    const bodyItems = items.filter(i => !isSuper(i))
    const superItems = items.filter(i => isSuper(i))
    const partsText = (parts) => parts.map(p => typeof p === 'string' ? p : p.text).join(' ').trim()

    // Pass 1: Group body items into lines (1.5% y-threshold + 20% x-gap splitting)
    // Fine-print text (< 55% of body font) uses tighter 0.4% Y gap to prevent
    // merging distinct footer lines (citations, abbreviations, copyright)
    bodyItems.sort((a, b) => a.y - b.y || a.x - b.x)
    const X_GAP = 20
    const LINE_Y_GAP = 1.5
    const SMALL_FONT_Y_GAP = 0.4
    const smallFontLimit = bodyFontSize * 0.55
    const lines = []
    let currentLine = null

    for (const item of bodyItems) {
      const isSmallItem = item.fontSize > 0 && item.fontSize < smallFontLimit
      const lineIsSmall = currentLine && currentLine.maxFontSize > 0 && currentLine.maxFontSize < smallFontLimit
      const yGap = (isSmallItem && lineIsSmall) ? SMALL_FONT_Y_GAP : LINE_Y_GAP
      const newY = !currentLine || Math.abs(item.y - currentLine.y) > yGap
      const xGap = !newY && Math.abs(item.x - currentLine.lastX) > X_GAP
      if (newY || xGap) {
        currentLine = {
          y: item.y, x: item.x, lastX: item.x, maxX: item.x,
          parts: [{ text: item.text, x: item.x }],
          superParts: [], superPositions: [],
          hasBodyFont: item.fontSize >= superThreshold,
          maxFontSize: item.fontSize
        }
        lines.push(currentLine)
      } else {
        currentLine.parts.push({ text: item.text, x: item.x })
        currentLine.lastX = item.x
        if (item.x > currentLine.maxX) currentLine.maxX = item.x
        if (item.fontSize >= superThreshold) currentLine.hasBodyFont = true
        if (item.fontSize > currentLine.maxFontSize) currentLine.maxFontSize = item.fontSize
      }
    }

    // Detect "Speaker notes" boundary
    let notesBoundaryY = null
    let hasSpeakerNotes = false
    for (const line of lines) {
      const text = partsText(line.parts)
      if (/^speaker\s+notes?\s*$/i.test(text)) {
        notesBoundaryY = Math.round(line.y * 10) / 10
        hasSpeakerNotes = true
        break
      }
    }

    // Pass 2: Associate each superscript item with its nearest body line
    for (const sup of superItems) {
      let bestLine = null
      let bestDist = Infinity
      const inSlideRegion = !notesBoundaryY || sup.y < notesBoundaryY

      for (const line of lines) {
        if (!line.hasBodyFont) continue
        const yDist = Math.abs(sup.y - line.y)
        if (yDist >= 3) continue
        if (inSlideRegion) {
          const lineMaxX = line.maxX ?? line.lastX ?? line.x
          if (sup.x < line.x - 5 || sup.x > lineMaxX + 20) continue
        }
        if (yDist < bestDist) {
          bestDist = yDist
          bestLine = line
        }
      }
      if (bestLine) {
        bestLine.superParts.push(sup.text.trim())
        bestLine.superPositions.push({ text: sup.text.trim(), x: sup.x })
      }
    }

    // Pass 3: Split lines with multiple superscripts at different X-positions
    const splitLines = []
    for (const line of lines) {
      if (line.superPositions.length <= 1) {
        splitLines.push(line)
        continue
      }
      const sortedSupers = [...line.superPositions].sort((a, b) => a.x - b.x)
      if (sortedSupers[sortedSupers.length - 1].x - sortedSupers[0].x < 8) {
        splitLines.push(line)
        continue
      }
      const sortedParts = [...line.parts].sort((a, b) => a.x - b.x)
      let lastPartIdx = 0
      for (let si = 0; si < sortedSupers.length; si++) {
        const sup = sortedSupers[si]
        const nextSup = sortedSupers[si + 1]
        let cutIdx = sortedParts.length
        if (nextSup) {
          const boundary = (sup.x + nextSup.x) / 2
          const found = sortedParts.findIndex((p, i) => i >= lastPartIdx && p.x > boundary)
          if (found >= 0) cutIdx = found
        }
        const segParts = sortedParts.slice(lastPartIdx, cutIdx)
        if (segParts.length > 0) {
          splitLines.push({
            y: line.y, x: segParts[0].x,
            lastX: segParts[segParts.length - 1].x,
            maxX: Math.max(...segParts.map(p => p.x)),
            parts: segParts,
            superParts: [sup.text],
            superPositions: [sup],
            hasBodyFont: line.hasBodyFont
          })
        }
        lastPartIdx = cutIdx
      }
    }
    lines.length = 0
    lines.push(...splitLines)

    // Build final line objects with ref numbers
    pages.push({
      pageNum,
      notesBoundaryY,
      hasSpeakerNotes,
      lines: lines.map(l => {
        const refs = new Set()
        // Path 1: font-size-detected superscripts
        for (const sp of l.superParts) {
          parseNumericCitationRefs(sp).forEach(ref => refs.add(ref))
        }
        // Path 2: trailing plain digits
        extractTrailingCitationRefs(partsText(l.parts)).forEach(ref => refs.add(ref))
        // Path 3 (Fix A): Unicode superscript chars embedded in line text
        parseSuperscriptCitationRefs(partsText(l.parts)).forEach(ref => refs.add(ref))

        const sortedRefs = [...refs].sort((a, b) => a - b)
        return {
          text: partsText(l.parts),
          y: Math.round(l.y * 10) / 10,
          x: Math.round(l.x * 10) / 10,
          maxX: Math.round((l.maxX ?? l.x) * 10) / 10,
          refs: sortedRefs
        }
      }).filter(l => l.text.length > 2)
    })

    page.cleanup()
  }

  pdfDoc.destroy()
  return pages
}

// ─── Step 2: Parse Candidates and Reference Pools ─────────────────────────────

function parseTextAnnotations(pages) {
  const result = { candidates: [], slideFootnotes: {}, notesReferences: {} }
  const refsHeaderPattern = /^references?\s*[,:;.]?\s*$/i

  const shouldIgnoreReferenceLine = (lineText) => {
    const clean = String(lineText || '').trim()
    if (!clean) return true
    if (refsHeaderPattern.test(clean)) return true
    if (/©\s*\d{4}/i.test(clean)) return true
    if (/^all rights reserved\.?$/i.test(clean)) return true
    if (/^\d+\s+©\s*\d{4}/i.test(clean)) return true
    return false
  }

  const looksLikeCitation = (text) => {
    const clean = String(text || '').trim()
    if (/\bet al\b/i.test(clean)) return true
    if (/\bdoi[:.]/i.test(clean)) return true
    // Year must appear in citation context (preceded by '. ' or '; ' or '(')
    // Bare years in running text like "between 2000 and 2010" must NOT match
    if (/[.;(]\s*(19|20)\d{2}\b/.test(clean)) return true
    return false
  }

  for (const page of pages) {
    const { pageNum, notesBoundaryY } = page
    const slideLines = []
    const notesLines = []

    // Split lines into slide vs notes regions
    for (const line of page.lines) {
      if (notesBoundaryY && line.y >= notesBoundaryY) {
        notesLines.push(line)
      } else {
        slideLines.push(line)
      }
    }

    // ── Extract slide footnotes (bottom of slide, y > 30%) ──
    const slidePool = {}
    const slideFootnoteLineYs = new Set()

    // Look for numbered references: "1. Author et al..."
    // Guard: discard ref numbers > 30 — pharma slides rarely exceed 10-15 refs
    // per page, and high numbers (79, 84, 93, 94) are typically page/volume
    // numbers from continuation text that mimic the "N. " pattern.
    const MAX_SLIDE_FOOTNOTE_REF = 30
    for (const line of slideLines) {
      if (line.y <= 30) continue
      const rawInlineRefs = extractInlineNumberedReferences(line.text)
      const inlineRefs = rawInlineRefs
        .filter(ref => Number(ref.number) <= MAX_SLIDE_FOOTNOTE_REF)
      // Accept the line if the first valid ref starts at 0, OR if a filtered-out
      // phantom ref occupied position 0 (text bleed from page/volume numbers).
      const firstRawAtZero = rawInlineRefs.length > 0 && rawInlineRefs[0].start === 0
      const firstFilteredAtZero = inlineRefs.length > 0 && inlineRefs[0].start === 0
      if (inlineRefs.length > 0 && (firstFilteredAtZero || firstRawAtZero)) {
        for (const ref of inlineRefs) {
          slidePool[ref.number] = stripSuperscripts(ref.text).trim()
        }
        slideFootnoteLineYs.add(line.y)
      }
    }

    // Collect continuation lines for footnotes
    if (Object.keys(slidePool).length > 0) {
      const footnoteYs = [...slideFootnoteLineYs].sort((a, b) => a - b)
      for (const line of slideLines) {
        if (slideFootnoteLineYs.has(line.y)) continue
        if (line.y <= 30) continue
        // Find the closest preceding footnote
        let closestRef = null
        for (let i = footnoteYs.length - 1; i >= 0; i--) {
          if (footnoteYs[i] < line.y && (line.y - footnoteYs[i]) < 3) {
            // Match to the last valid ref on the closest preceding footnote line
            for (const refLine of slideLines) {
              if (Math.abs(refLine.y - footnoteYs[i]) < 0.5) {
                const lineRefs = extractInlineNumberedReferences(refLine.text)
                  .filter(ref => Number(ref.number) <= MAX_SLIDE_FOOTNOTE_REF)
                if (lineRefs.length > 0) {
                  closestRef = lineRefs[lineRefs.length - 1].number
                }
              }
            }
            break
          }
        }
        if (closestRef && !shouldIgnoreReferenceLine(line.text)) {
          slidePool[closestRef] += ' ' + stripSuperscripts(line.text).trim()
        }
      }
    }

    // Fallback: if no numbered footnotes, look for citation-like text at bottom
    if (Object.keys(slidePool).length === 0) {
      let citationIdx = 1
      for (const line of slideLines) {
        if (line.y <= 30) continue
        if (shouldIgnoreReferenceLine(line.text)) continue
        // Skip footnote explanations (lines starting with *, †, ‡, §, etc.)
        if (/^[*†‡§¶‖]/.test(line.text.trim())) continue
        if (looksLikeCitation(line.text)) {
          slidePool[String(citationIdx)] = stripSuperscripts(line.text).trim()
          slideFootnoteLineYs.add(line.y)
          citationIdx++
        }
      }
    }

    if (Object.keys(slidePool).length > 0) {
      result.slideFootnotes[pageNum] = slidePool
    }

    // ── Extract notes references (after "References:" header) ──
    const notesPool = {}
    let inRefsSection = false
    let currentRefNum = null

    for (const line of notesLines) {
      const text = line.text.trim()

      if (refsHeaderPattern.test(text) || /^references?\s*$/i.test(text)) {
        inRefsSection = true
        continue
      }

      if (!inRefsSection) continue
      if (shouldIgnoreReferenceLine(text)) continue

      // Numbered reference: "1. Author..."
      const inlineRefs = extractInlineNumberedReferences(text)
      if (inlineRefs.length > 0 && inlineRefs[0].start === 0) {
        const firstRef = inlineRefs[0]
        const currentNumeric = Number.parseInt(currentRefNum, 10)
        const nextNumeric = Number.parseInt(firstRef.number, 10)
        const looksLikeContinuation =
          currentRefNum &&
          Number.isFinite(currentNumeric) &&
          Number.isFinite(nextNumeric) &&
          nextNumeric > currentNumeric + 1 &&
          (
            /^\s*doi[:.]/i.test(firstRef.text) ||
            /^\s*(?:pp?\.?|vol\.?|issue\b|\d)/i.test(firstRef.text) ||
            !/^[A-Z][a-z\u00c0-\u024f'-]+\s/.test(firstRef.text)
          )

        if (looksLikeContinuation) {
          notesPool[currentRefNum] += ' ' + stripSuperscripts(text).trim()
          continue
        }

        for (const ref of inlineRefs) {
          currentRefNum = ref.number
          notesPool[currentRefNum] = stripSuperscripts(ref.text).trim()
        }
        continue
      }

      // Unnumbered continuation or new author line
      if (currentRefNum) {
        const prevText = notesPool[currentRefNum] || ''
        // Only consider "new author" if previous citation looks complete (ends with sentence terminator).
        // Incomplete text like "...in Guillain" (no period) is always a continuation.
        const prevLooksComplete = /[.)]\s*$/.test(prevText)
        const startsWithAuthor = prevLooksComplete &&
          /^[A-Z][a-z\u00c0-\u024f'-]+\s/.test(text) && looksLikeCitation(text)
        if (startsWithAuthor) {
          currentRefNum = String(Number(currentRefNum) + 1)
          notesPool[currentRefNum] = stripSuperscripts(text).trim()
        } else {
          notesPool[currentRefNum] += ' ' + stripSuperscripts(text).trim()
        }
      } else if (looksLikeCitation(text)) {
        currentRefNum = '1'
        notesPool[currentRefNum] = stripSuperscripts(text).trim()
      }
    }

    if (Object.keys(notesPool).length > 0) {
      result.notesReferences[pageNum] = notesPool
    }

    // ── Build candidates from slide lines with superscripts ──
    for (let i = 0; i < slideLines.length; i++) {
      const line = slideLines[i]
      if (line.refs.length === 0) continue

      // Skip if this line IS a footnote definition
      if (line.y > 30 && slideFootnoteLineYs.has(line.y)) continue

      // Skip short all-caps headings
      if (looksLikeShortHeading(line.text)) continue

      // Expand to full statement context
      const { text, startY, startX } = collectFullStatement(slideLines, i)
      if (!text || text.length < 5) continue
      // Skip pure-numeric/range text like "1 - 3" that has no meaningful alpha content
      const slideAlpha = text.replace(/[^a-zA-Z]/g, '')
      if (slideAlpha.length < 4) continue

      result.candidates.push({
        text: stripSuperscripts(text),
        region: 'slide',
        refNumbers: [...line.refs],
        page: pageNum,
        pdfJsY: startY,
        pdfJsX: startX
      })
    }

    // ── Build candidates from notes lines with superscripts ──
    const notesContentLines = []
    for (const line of notesLines) {
      if (refsHeaderPattern.test(line.text.trim()) || /^references?\s*$/i.test(line.text.trim())) break
      notesContentLines.push(line)
    }

    for (let i = 0; i < notesContentLines.length; i++) {
      const line = notesContentLines[i]
      if (line.refs.length === 0) continue
      if (looksLikeShortHeading(line.text)) continue
      if (/^speaker\s+notes?\s*$/i.test(line.text.trim())) continue

      const { text, startY, startX } = collectFullStatement(notesContentLines, i)
      if (!text || text.length < 5) continue
      if (/^speaker\s+notes?\s*$/i.test(text.trim())) continue
      // Skip pure-numeric/range text like "1 - 3" that has no meaningful alpha content
      const notesAlpha = text.replace(/[^a-zA-Z]/g, '')
      if (notesAlpha.length < 4) continue

      result.candidates.push({
        text: stripSuperscripts(text),
        region: 'notes',
        refNumbers: [...line.refs],
        page: pageNum,
        pdfJsY: startY,
        pdfJsX: startX
      })
    }

    // Orphan slide/notes refs are NOT emitted as candidates here.
    // buildTextOnlyAnnotations handles orphan pool entries with globalSpot positioning.
  }

  return result
}

// ─── Step 2b: Document AI slide-region extraction ───────────────────────────

async function fetchDocumentAiPages(pdfFile) {
  const formData = new FormData()
  formData.append('file', pdfFile)

  const response = await fetch('/api/document-ai/extract', {
    method: 'POST',
    body: formData
  })

  if (!response.ok) return null
  const data = await response.json()
  return data.pages
}

function mergeSlideRegion(pdfJsPages, docAiPages) {
  return pdfJsPages.map(pdfJsPage => {
    const docAiPage = docAiPages.find(p => p.pageNum === pdfJsPage.pageNum)
    if (!docAiPage) return pdfJsPage

    const boundary = pdfJsPage.notesBoundaryY

    // Document AI lines for the slide region (above notes boundary)
    const slideLines = docAiPage.lines.filter(l => !boundary || l.y < boundary)
    // pdf.js lines for the notes region (at/below notes boundary)
    const notesLines = pdfJsPage.lines.filter(l => boundary && l.y >= boundary)

    return {
      ...pdfJsPage,
      lines: [...slideLines, ...notesLines].sort((a, b) => {
        const yDiff = a.y - b.y
        return Math.abs(yDiff) <= 1 ? a.x - b.x : yDiff
      })
    }
  })
}

// ─── Step 2c: Gemini Vision superscript detection for orphan pages ──────────

/**
 * Render a PDF page to a base64 PNG using pdf.js canvas rendering.
 */
async function renderPageToBase64(pdfFile, pageNum) {
  const arrayBuffer = await pdfFile.arrayBuffer()
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const page = await pdfDoc.getPage(pageNum)
  const scale = 1.5 // Good balance of quality vs size
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')

  await page.render({ canvasContext: ctx, viewport }).promise
  const dataUrl = canvas.toDataURL('image/png')
  page.cleanup()
  pdfDoc.destroy()

  // Strip "data:image/png;base64," prefix
  return dataUrl.split(',')[1]
}

/**
 * Identify pages that need Gemini Vision for the slide region.
 * Two cases:
 *   1. "Orphan" — slide footnotes exist but no text-layer superscript candidates
 *   2. "Garbled" — text-layer candidates exist but look like infographic text
 *      read left-to-right across columns (multiple candidates share identical text)
 *
 * When Vision provides results for a garbled page, the old text-layer
 * candidates for that page are replaced.
 */
function findPagesNeedingVision(textParsed) {
  const pagesNeedingVision = new Set()

  const footnotePages = Object.keys(textParsed.slideFootnotes).map(Number)

  // Group slide candidates by page
  const slideCandidatesByPage = new Map()
  for (const c of textParsed.candidates) {
    if (c.region !== 'slide') continue
    if (!slideCandidatesByPage.has(c.page)) slideCandidatesByPage.set(c.page, [])
    slideCandidatesByPage.get(c.page).push(c)
  }

  for (const pageNum of footnotePages) {
    const pageCandidates = slideCandidatesByPage.get(pageNum)
    const poolRefs = new Set(Object.keys(textParsed.slideFootnotes[pageNum] || {}))

    // Case 1: No slide candidates at all → orphan
    if (!pageCandidates || pageCandidates.length === 0) {
      pagesNeedingVision.add(pageNum)
      continue
    }

    // Case 2: Multiple candidates sharing identical text → garbled infographic
    const textCounts = new Map()
    for (const c of pageCandidates) {
      const key = c.text.slice(0, 80)
      textCounts.set(key, (textCounts.get(key) || 0) + 1)
    }
    const hasDuplicateText = [...textCounts.values()].some(count => count >= 2)
    if (hasDuplicateText) {
      pagesNeedingVision.add(pageNum)
      continue
    }

    // Case 3: Footnote pool has refs that no candidate claims → partial orphan
    const claimedRefs = new Set(
      pageCandidates.flatMap(c => (c.refNumbers || []).map(String))
    )
    const unclaimedCount = [...poolRefs].filter(r => !claimedRefs.has(r)).length
    if (unclaimedCount > 0 && poolRefs.size > 1) {
      pagesNeedingVision.add(pageNum)
    }
  }

  return [...pagesNeedingVision].sort((a, b) => a - b)
}

/**
 * For pages needing Vision, use Gemini to extract annotated statements from
 * the slide image — complete text with superscripts and positions.
 * For garbled pages, replaces the old text-layer candidates.
 */
async function enrichWithGeminiVision(pdfFile, pages, textParsed, onProgress) {
  const visionPages = findPagesNeedingVision(textParsed)
  if (visionPages.length === 0) return 0

  logger.info(`Gemini Vision: ${visionPages.length} pages to scan`, { visionPages })
  let added = 0

  for (let i = 0; i < visionPages.length; i++) {
    const pageNum = visionPages[i]
    const pageData = pages.find(p => p.pageNum === pageNum)
    const notesBoundaryY = pageData?.notesBoundaryY || 50
    const slideFootnotes = textParsed.slideFootnotes[pageNum] || {}

    const pct = 40 + Math.round((i / visionPages.length) * 25)
    onProgress?.(pct, `Reading slide ${pageNum} with Gemini Vision...`)

    try {
      const imageBase64 = await renderPageToBase64(pdfFile, pageNum)
      const annotations = await detectSlideSuperscripts(
        imageBase64, pageNum, slideFootnotes, notesBoundaryY
      )

      if (annotations.length > 0) {
        // Check if old candidates were garbled (duplicate text)
        const oldSlideCandidates = textParsed.candidates.filter(
          c => c.region === 'slide' && c.page === pageNum && c.source !== 'gemini-vision'
        )
        const oldTexts = oldSlideCandidates.map(c => c.text.slice(0, 80))
        const hasGarbled = oldTexts.some((t, i) => oldTexts.indexOf(t) !== i)

        if (hasGarbled) {
          // Garbled page: remove all old slide candidates, Vision replaces them
          textParsed.candidates = textParsed.candidates.filter(
            c => !(c.region === 'slide' && c.page === pageNum && c.source !== 'gemini-vision')
          )
        }
        // Partial orphan: keep existing good candidates, just add Vision ones
      }

      for (const ann of annotations) {
        textParsed.candidates.push({
          text: String(ann.statement || '').slice(0, 150),
          region: 'slide',
          refNumbers: Array.isArray(ann.refNumbers) ? ann.refNumbers : [ann.refNumbers],
          page: pageNum,
          pdfJsY: ann.y,
          pdfJsX: ann.x,
          source: 'gemini-vision'
        })
        added++
      }
    } catch (err) {
      logger.warn(`Gemini Vision failed for page ${pageNum}: ${err.message}`)
    }
  }

  return added
}

// ─── Step 3: Public Entry Point ───────────────────────────────────────────────

export async function extractAnnotations(pdfFile, onProgress) {
  onProgress?.(10, 'Extracting text from PDF...')
  const pdfJsPages = await extractPageTextLines(pdfFile)

  // Use Document AI OCR for the slide/image region; fall back to pdf.js-only on error
  onProgress?.(20, 'Processing slide images with Document AI...')
  let pages = pdfJsPages
  try {
    const docAiPages = await fetchDocumentAiPages(pdfFile)
    if (docAiPages?.length) {
      pages = mergeSlideRegion(pdfJsPages, docAiPages)
      logger.info('Document AI slide merge complete', {
        docAiPages: docAiPages.length,
        totalPages: pages.length
      })
    }
  } catch (err) {
    logger.warn('Document AI extraction failed, using pdf.js only', err.message)
  }

  onProgress?.(30, 'Parsing references and candidates...')
  const textParsed = parseTextAnnotations(pages)

  logger.info('extractAnnotations parsed', {
    pages: pages.length,
    candidates: textParsed.candidates.length,
    slideFootnotePages: Object.keys(textParsed.slideFootnotes).length,
    notesReferencePages: Object.keys(textParsed.notesReferences).length
  })

  // Gemini Vision fallback: scan orphan slide pages for superscripts
  const visionAdded = await enrichWithGeminiVision(pdfFile, pages, textParsed, onProgress)
  if (visionAdded > 0) {
    logger.info(`Gemini Vision added ${visionAdded} superscript candidates`)
  }

  onProgress?.(70, 'Building annotations...')
  const { annotations, annotationBindings, globalAnnotationCount } = buildTextOnlyAnnotations(textParsed)

  onProgress?.(90, 'Finalizing...')
  return {
    success: true,
    annotations,
    annotationBindings,
    aiFinds: [],
    globalAnnotationCount,
    usage: { inputTokens: 0, outputTokens: 0, cost: 0, model: 'deterministic' }
  }
}

// Export internals for testing
export { extractPageTextLines, parseTextAnnotations }
