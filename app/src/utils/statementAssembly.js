function isBulletStarter(text, row) {
  const clean = String(text || '').trim()
  if (!clean) return false

  const minX = Math.min(...row.lines.map(line => Number(line.x) || 0))

  if (/^[•○▪]\s+/.test(clean)) return true
  if (/^(?:-|–)\s+/.test(clean)) return minX <= 25
  if (/^o\s+/.test(clean)) return minX <= 25

  return false
}

function trimEmbeddedBulletContinuation(text) {
  const clean = String(text || '').trim()
  const markerPattern = /\s+(?:[®™†‡§¶‖*]\s*)*(?<marker>[•○▪]|[–-]|o)\s+(?=[A-Z])/g
  let match

  while ((match = markerPattern.exec(clean)) !== null) {
    const prefix = clean.slice(0, match.index).trim()
    const suffix = clean.slice(match.index).trim()
    const marker = match.groups?.marker || ''
    const prefixLooksLikeSentence =
      prefix.length >= 24 &&
      /[a-z0-9.)%]$/.test(prefix) &&
      !/[A-Z]$/.test(prefix)

    const safeDashBreak = marker === '-' || marker === '–'
    if (safeDashBreak && !prefixLooksLikeSentence) continue
    if (marker === 'o' && prefix.length < 18) continue
    if (!suffix) continue

    return {
      text: prefix,
      trimmed: true
    }
  }

  return { text: clean, trimmed: false }
}

function isFootnoteOrHeaderRow(text, row) {
  const clean = String(text || '').trim()
  if (!clean) return true
  if (/^speaker\s+notes?\s*$/i.test(clean)) return true
  if (/^references?\s*[,:;.]?\s*$/i.test(clean)) return true
  if (/^\d+\.\s/.test(clean) && (Number(row.y) || 0) > 30) return true
  if ((Number(row.y) || 0) > 35 && /\b\d+\.\s+\S+/.test(clean) && (/\bet al\b/i.test(clean) || /\bdoi[:.]/i.test(clean) || /\b(19|20)\d{2}\b/.test(clean))) return true
  if (/©\s*\d{4}/i.test(clean)) return true
  if (/^all rights reserved\.?$/i.test(clean)) return true
  return false
}

function rowHasRefs(row) {
  return row.lines.some(line => Array.isArray(line.refs) && line.refs.length > 0)
}

function getRowText(row) {
  const fragments = row.lines
    .map(line => String(line.text || '').trim())
    .filter(Boolean)
    .filter((fragment, index, all) => {
      if (all.length === 1) return true
      if (/^(?:[®™†‡§¶‖*]\s*)+$/.test(fragment)) return false
      if (/^-$/.test(fragment)) return false
      return true
    })

  return fragments.join(' ').replace(/\s+/g, ' ').trim()
}

function getRowMinX(row) {
  return Math.min(...row.lines.map(line => Number(line.x) || 0))
}

export function looksLikeShortHeading(text) {
  const clean = String(text || '').replace(/[^\w\s+-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!clean) return false
  const tokens = clean.split(' ').filter(Boolean)
  if (tokens.length === 0 || tokens.length > 6) return false

  const alphaChars = clean.replace(/[^A-Za-z]/g, '')
  if (alphaChars.length < 4) return false
  const uppercaseChars = alphaChars.replace(/[^A-Z]/g, '').length
  return (uppercaseChars / alphaChars.length) >= 0.55
}

function buildVisualRows(lines) {
  const rows = []
  const lineToRowIndex = new Map()
  const Y_GROUP_GAP = 0.45
  const COLUMN_RESET_THRESHOLD = 10

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const lineMinX = Number(line.x) || 0
    const lineMaxX = Number(line.maxX) || lineMinX
    const lastRow = rows[rows.length - 1]
    const sameBand = lastRow && Math.abs((Number(line.y) || 0) - lastRow.y) <= Y_GROUP_GAP
    const movedBackToEarlierColumn = sameBand && (lineMinX < (lastRow.maxX - COLUMN_RESET_THRESHOLD))

    if (!lastRow || !sameBand || movedBackToEarlierColumn) {
      rows.push({
        y: Number(line.y) || 0,
        lines: [line],
        indices: [index],
        minX: lineMinX,
        maxX: lineMaxX
      })
      lineToRowIndex.set(index, rows.length - 1)
      continue
    }

    lastRow.lines.push(line)
    lastRow.indices.push(index)
    lastRow.minX = Math.min(lastRow.minX, lineMinX)
    lastRow.maxX = Math.max(lastRow.maxX, lineMaxX)
    lineToRowIndex.set(index, rows.length - 1)
  }

  return { rows, lineToRowIndex }
}

export function collectFullStatement(lines, targetIdx) {
  const target = lines[targetIdx]
  if (!target) {
    return {
      text: '',
      startY: 0,
      startX: 0
    }
  }

  const { rows, lineToRowIndex } = buildVisualRows(lines)
  const targetRowIdx = lineToRowIndex.get(targetIdx)
  const MAX_ROW_GAP = 2.2
  const MAX_COLUMN_DRIFT = 18
  const targetRowText = getRowText(rows[targetRowIdx])
  const trimmedTargetRow = trimEmbeddedBulletContinuation(targetRowText)
  const targetIsShortHeading = looksLikeShortHeading(trimmedTargetRow.text)
  const targetRowMinX = getRowMinX(rows[targetRowIdx])
  const targetIsRightSideCallout = targetRowMinX >= 55

  const selectedRowIndices = [targetRowIdx]
  let backwardAnchorY = rows[targetRowIdx].y
  let forwardAnchorY = rows[targetRowIdx].y

  for (let rowIdx = targetRowIdx - 1; rowIdx >= 0; rowIdx -= 1) {
    const previousRow = rows[rowIdx]
    if ((backwardAnchorY - previousRow.y) > MAX_ROW_GAP) break
    if (Math.abs(getRowMinX(previousRow) - targetRowMinX) > MAX_COLUMN_DRIFT) continue

    const previousText = getRowText(previousRow)
    if (isFootnoteOrHeaderRow(previousText, previousRow)) break

    const previousIsBullet = isBulletStarter(previousText, previousRow)
    const previousHasRefs = rowHasRefs(previousRow)
    if (previousHasRefs && !previousIsBullet) break

    selectedRowIndices.unshift(rowIdx)
    backwardAnchorY = previousRow.y
    if (previousIsBullet || previousHasRefs) break
  }

  if (!trimmedTargetRow.trimmed && !targetIsShortHeading && !targetIsRightSideCallout) {
    for (let rowIdx = targetRowIdx + 1; rowIdx < rows.length; rowIdx += 1) {
      const nextRow = rows[rowIdx]
      if ((nextRow.y - forwardAnchorY) > MAX_ROW_GAP) break
      if (Math.abs(getRowMinX(nextRow) - targetRowMinX) > MAX_COLUMN_DRIFT) continue

      const nextText = getRowText(nextRow)
      if (isFootnoteOrHeaderRow(nextText, nextRow)) break
      if (isBulletStarter(nextText, nextRow)) break
      if (rowHasRefs(nextRow)) break
      if ((Math.min(...nextRow.lines.map(line => Number(line.x) || 0)) + 2) < Math.min(...rows[targetRowIdx].lines.map(line => Number(line.x) || 0))) break

      selectedRowIndices.push(rowIdx)
      forwardAnchorY = nextRow.y
    }
  }

  const text = selectedRowIndices
    .map((rowIdx) => {
      const row = rows[rowIdx]
      if (rowIdx === targetRowIdx) return trimmedTargetRow.text
      return getRowText(row)
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  const startRow = rows[selectedRowIndices[0]]
  const startX = Math.min(...startRow.lines.map(line => Number(line.x) || 0))

  return {
    text,
    startY: startRow?.y ?? (Number(target.y) || 0),
    startX: Number.isFinite(startX) ? startX : (Number(target.x) || 0)
  }
}
