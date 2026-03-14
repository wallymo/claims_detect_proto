/**
 * Deterministic Annotation Pipeline for MKG3
 *
 * Extracts on-page references and maps them to content using pdf.js text layer.
 * No AI/Gemini — pure text extraction, superscript detection, and reference matching.
 *
 * Pipeline: extractPageTextLines() → parseTextAnnotations() → buildTextOnlyAnnotations()
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
import { isOcrServiceAvailable, renderPageToBlob, ocrSlideRegion, convertOcrLinesToPageLines } from '@/services/ocrClient'

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
    for (const line of slideLines) {
      if (line.y <= 30) continue
      const inlineRefs = extractInlineNumberedReferences(line.text)
      if (inlineRefs.length > 0 && inlineRefs[0].start === 0) {
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
            // Match to the ref whose Y is closest
            for (const refLine of slideLines) {
              if (Math.abs(refLine.y - footnoteYs[i]) < 0.5) {
                const refMatch = refLine.text.match(/^(\d+)[.)]\s+/)
                if (refMatch) closestRef = refMatch[1]
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

      result.candidates.push({
        text: stripSuperscripts(text),
        region: 'slide',
        refNumbers: [...line.refs],
        page: pageNum,
        pdfJsY: line.ocrSource ? line.ocrY : startY,
        pdfJsX: line.ocrSource ? line.ocrX : startX,
        ...(line.ocrSource ? { ocrSource: true } : {})
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

      const { text, startY, startX } = collectFullStatement(notesContentLines, i)
      if (!text || text.length < 5) continue

      result.candidates.push({
        text: stripSuperscripts(text),
        region: 'notes',
        refNumbers: [...line.refs],
        page: pageNum,
        pdfJsY: startY,
        pdfJsX: startX
      })
    }

    // ── Orphan reference detection ──
    const slideRefNums = new Set(
      result.candidates
        .filter(c => c.page === pageNum && c.region === 'slide')
        .flatMap(c => c.refNumbers.map(String))
    )
    const notesRefNums = new Set(
      result.candidates
        .filter(c => c.page === pageNum && c.region === 'notes')
        .flatMap(c => c.refNumbers.map(String))
    )

    // Orphan slide refs → pin to the slide (title or first content line)
    const orphanSlideRefs = Object.keys(slidePool).filter(r => !slideRefNums.has(r))
    if (orphanSlideRefs.length > 0) {
      // Find slide title (first line, usually largest font / lowest y)
      const titleLine = slideLines.find(l => l.y < 25 && l.text.length > 10)
      const anchorLine = titleLine || slideLines.find(l => l.y < 30 && l.text.length > 10) || slideLines[0]
      const anchorText = anchorLine?.text || ''

      result.candidates.push({
        text: stripSuperscripts(anchorText),
        region: 'slide',
        refNumbers: orphanSlideRefs.map(r => Number(r) || r),
        page: pageNum,
        pdfJsY: anchorLine?.ocrSource ? anchorLine.ocrY : (anchorLine?.y || 10),
        pdfJsX: anchorLine?.ocrSource ? anchorLine.ocrX : (anchorLine?.x || 5),
        ...(anchorLine?.ocrSource ? { ocrSource: true } : {})
      })
    }

    // Orphan notes refs → pin to the speaker notes (first content bullet)
    const orphanNotesRefs = Object.keys(notesPool).filter(r => !notesRefNums.has(r))
    if (orphanNotesRefs.length > 0) {
      const firstBullet = notesContentLines.find(l => l.text.length > 10) || notesContentLines[0]
      const anchorText = firstBullet?.text || ''

      result.candidates.push({
        text: stripSuperscripts(anchorText),
        region: 'notes',
        refNumbers: orphanNotesRefs.map(r => Number(r) || r),
        page: pageNum,
        pdfJsY: firstBullet?.y || 60,
        pdfJsX: firstBullet?.x || 5
      })
    }
  }

  return result
}

/**
 * Check if a page's slide region lacks meaningful text (pdf.js couldn't extract it).
 * Returns true if fewer than 3 lines with >10 chars exist above the notes boundary.
 */
export function isSlideRegionEmpty(page) {
  const boundary = page.notesBoundaryY ?? 55
  const slideLines = page.lines.filter(l => l.y < boundary && l.text.length > 10)
  return slideLines.length < 3
}

/**
 * Find the best OCR line match for a pdf.js text line by text overlap + Y proximity.
 * hintY is the pdf.js Y coordinate to bias toward nearby OCR lines.
 * usedOcrIndices tracks already-matched OCR lines to avoid double-claiming.
 *
 * Strategy:
 *  1. Try text matching (substring + token overlap) with Y-proximity bonus
 *  2. If text matching fails (common for short infographic text like "AT 3 YEARS"),
 *     fall back to closest OCR line by Y-proximity alone
 */
function findBestOcrMatch(pdfText, ocrLines, hintY = null, usedOcrIndices = null) {
  if (!pdfText || !ocrLines?.length) return null

  const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
  const pdfNorm = normalize(pdfText)
  if (!pdfNorm || pdfNorm.length < 4) return null

  const pdfTokens = new Set(pdfNorm.split(' ').filter(t => t.length > 2))

  let bestMatch = null
  let bestScore = 0
  let bestIdx = -1

  for (let idx = 0; idx < ocrLines.length; idx++) {
    if (usedOcrIndices?.has(idx)) continue

    const ocrLine = ocrLines[idx]
    const ocrNorm = normalize(ocrLine.text)
    if (!ocrNorm || ocrNorm.length < 3) continue

    let textScore = 0

    // Substring check — boost score for confirmed containment
    if (pdfNorm.includes(ocrNorm) || ocrNorm.includes(pdfNorm)) {
      const ratio = Math.min(pdfNorm.length, ocrNorm.length) / Math.max(pdfNorm.length, ocrNorm.length)
      // Short OCR text contained in long pdf.js text is still a valid match
      textScore = Math.max(ratio, 0.5)
    } else if (pdfTokens.size > 0) {
      // Token overlap
      const ocrTokens = ocrNorm.split(' ').filter(t => t.length > 2)
      const hits = ocrTokens.filter(t => pdfTokens.has(t)).length
      textScore = hits / pdfTokens.size
    }

    // Y proximity bonus: prefer OCR lines closer to the pdf.js Y position
    let yBonus = 0
    if (Number.isFinite(hintY) && Number.isFinite(ocrLine.y_pct)) {
      const yDist = Math.abs(hintY - ocrLine.y_pct)
      yBonus = Math.max(0, 0.3 - (yDist / 100))
    }

    const score = textScore + yBonus
    if (score > bestScore && textScore >= 0.15) {
      bestScore = score
      bestMatch = ocrLine
      bestIdx = idx
    }
  }

  // Text match succeeded
  if (bestScore >= 0.4 && bestMatch) {
    if (usedOcrIndices && bestIdx >= 0) usedOcrIndices.add(bestIdx)
    return bestMatch
  }

  // Fallback: closest OCR line by Y-proximity when text matching fails
  // (common for short infographic text on stat-heavy slides)
  if (Number.isFinite(hintY)) {
    let closestLine = null
    let closestDist = Infinity
    let closestIdx = -1

    for (let idx = 0; idx < ocrLines.length; idx++) {
      if (usedOcrIndices?.has(idx)) continue
      const ocrLine = ocrLines[idx]
      if (!ocrLine.text || ocrLine.text.trim().length < 3) continue
      const yDist = Math.abs(hintY - ocrLine.y_pct)
      if (yDist < closestDist && yDist < 8) {  // within 8% Y distance
        closestDist = yDist
        closestLine = ocrLine
        closestIdx = idx
      }
    }

    if (closestLine) {
      if (usedOcrIndices && closestIdx >= 0) usedOcrIndices.add(closestIdx)
      return closestLine
    }
  }

  return null
}

// ─── Step 3: Public Entry Point ───────────────────────────────────────────────

export async function extractAnnotations(pdfFile, onProgress) {
  onProgress?.(10, 'Extracting text from PDF...')
  const pages = await extractPageTextLines(pdfFile)

  // ── OCR for slide position refinement (pdf.js text + OCR visual positions) ──
  // Only OCR pages that have superscript-bearing slide lines (= annotation candidates).
  // Pages with no refs in the slide region won't produce pins, so OCR is pointless.
  const pagesNeedingOcr = pages.filter(p => {
    const boundary = p.notesBoundaryY ?? 55
    return p.lines.some(l => l.y < boundary && l.refs.length > 0)
  })

  const ocrAvailable = pagesNeedingOcr.length > 0 && await isOcrServiceAvailable()
  if (ocrAvailable) {
    onProgress?.(15, `OCR positioning: ${pagesNeedingOcr.length} of ${pages.length} slides...`)
    const arrayBuffer = await pdfFile.arrayBuffer()
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

    for (let i = 0; i < pagesNeedingOcr.length; i++) {
      const page = pagesNeedingOcr[i]
      const pdfPage = await pdfDoc.getPage(page.pageNum)

      onProgress?.(15 + (i / pagesNeedingOcr.length) * 25,
        `OCR positioning: page ${page.pageNum} (${i + 1}/${pagesNeedingOcr.length})...`)

      const rendered = await renderPageToBlob(pdfPage, 200)
      if (!rendered) { pdfPage.cleanup(); continue }

      const cropBottom = page.notesBoundaryY || 48
      const ocrResult = await ocrSlideRegion(rendered.blob, cropBottom)
      if (!ocrResult || !ocrResult.lines || ocrResult.lines.length === 0) { pdfPage.cleanup(); continue }

      // Match pdf.js slide lines to OCR visual positions
      const boundary = page.notesBoundaryY ?? 55
      const usedOcrIndices = new Set()
      let matched = 0
      for (const line of page.lines) {
        if (line.y >= boundary) continue // skip notes lines
        const ocrMatch = findBestOcrMatch(line.text, ocrResult.lines, line.y, usedOcrIndices)
        if (ocrMatch) {
          line.ocrX = ocrMatch.x_pct
          line.ocrY = ocrMatch.y_pct
          line.ocrSource = true
          matched++
        }
      }

      logger.info('OCR position matching', {
        page: page.pageNum,
        slideLines: page.lines.filter(l => l.y < boundary).length,
        ocrLines: ocrResult.lines.length,
        matched,
        elapsed: ocrResult.elapsed_ms
      })

      pdfPage.cleanup()
    }
    pdfDoc.destroy()
  } else {
    logger.info('OCR service not available — using pdf.js positions for slides')
  }

  onProgress?.(40, 'Parsing references and candidates...')
  const textParsed = parseTextAnnotations(pages)

  logger.info('extractAnnotations parsed', {
    pages: pages.length,
    candidates: textParsed.candidates.length,
    slideFootnotePages: Object.keys(textParsed.slideFootnotes).length,
    notesReferencePages: Object.keys(textParsed.notesReferences).length
  })

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
