export function summarizeAnnotationClaims(claims) {
  const summary = {
    total: 0,
    onPageCount: 0,
    aiFindCount: 0,
    globalAnnotationCount: 0
  }

  for (const claim of Array.isArray(claims) ? claims : []) {
    if (!claim || typeof claim !== 'object') continue
    summary.total += 1
    if (claim.source === 'on-page') summary.onPageCount += 1
    if (claim.source === 'ai-find') summary.aiFindCount += 1
    if (claim.globalSpot) summary.globalAnnotationCount += 1
  }

  return summary
}
