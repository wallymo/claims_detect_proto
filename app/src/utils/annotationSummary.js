export function summarizeAnnotationClaims(claims) {
  const summary = {
    total: 0,
    onPageCount: 0,
    aiFindCount: 0,
    globalAnnotationCount: 0,
    unreferencedCount: 0
  }

  for (const claim of Array.isArray(claims) ? claims : []) {
    if (!claim || typeof claim !== 'object') continue
    summary.total += 1
    if (claim.source === 'on-page' || claim.source === 'pymupdf') summary.onPageCount += 1
    if (claim.source === 'ai-find') summary.aiFindCount += 1
    if (claim.globalSpot) summary.globalAnnotationCount += 1
    if (!claim.matched || !Array.isArray(claim.references) || claim.references.length === 0) {
      summary.unreferencedCount += 1
    }
  }

  return summary
}
