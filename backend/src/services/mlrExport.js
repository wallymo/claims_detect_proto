function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function uniqueLines(lines) {
  const seen = new Set()
  const result = []

  for (const rawLine of Array.isArray(lines) ? lines : []) {
    const line = normalizeText(rawLine)
    if (!line) continue
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(line)
  }

  return result
}

export function determineGutterSide(claim) {
  if (claim?.globalSpot) return 'right'

  const positionX = Number(claim?.position?.x)
  if (!Number.isFinite(positionX)) return 'right'

  return positionX < 50 ? 'left' : 'right'
}

export function resolveReferenceNotationLines(reference, acceptedEvidence = [], totalReferences = 1) {
  const acceptedLines = uniqueLines(
    acceptedEvidence
      .map(item => item?.location_annotation)
  )

  let lines = acceptedLines
  if (lines.length === 0) {
    const locatorLine = normalizeText(reference?.locator?.location_annotation)
    if (locatorLine) {
      lines = [locatorLine]
    }
  }

  if (lines.length === 0) {
    const citationLine = normalizeText(
      reference?.text || reference?.name || reference?.display_alias || reference?.filename
    )
    if (citationLine) {
      lines = [citationLine]
    }
  }

  if (lines.length === 0) return []

  if (totalReferences <= 1) return lines

  const refNumber = Number(reference?.number)
  if (!Number.isFinite(refNumber)) return lines

  return lines.map((line, index) => (
    index === 0 ? `${refNumber}. ${line}` : line
  ))
}

export function buildApprovedExportClaims(claims, { getAcceptedEvidenceForPair } = {}) {
  const approvedClaims = Array.isArray(claims) ? claims : []

  return approvedClaims
    .filter(claim => claim?.status === 'approved')
    .map((claim) => {
      const references = Array.isArray(claim.references) ? claim.references : []
      const notationLines = []

      for (const reference of references) {
        const refId = Number(reference?.id)
        const acceptedEvidence = Number.isFinite(refId) && typeof getAcceptedEvidenceForPair === 'function'
          ? getAcceptedEvidenceForPair(claim.id, refId)
          : []

        notationLines.push(
          ...resolveReferenceNotationLines(reference, acceptedEvidence, references.length)
        )
      }

      const dedupedNotationLines = uniqueLines(notationLines)
      if (dedupedNotationLines.length === 0) return null

      const rawTargetYPct = Number(claim?.position?.y)
      const targetYPct = Number.isFinite(rawTargetYPct)
        ? clamp(rawTargetYPct, 2, 98)
        : (claim?.globalSpot ? 15 : 50)

      return {
        claim_id: String(claim.id || ''),
        page: Math.max(1, Number.parseInt(claim?.page, 10) || 1),
        global_spot: Boolean(claim?.globalSpot),
        target_side: determineGutterSide(claim),
        target_y_pct: targetYPct,
        notation_lines: dedupedNotationLines,
        claim_text: normalizeText(claim?.statement || claim?.text || claim?.claim),
      }
    })
    .filter(Boolean)
}
