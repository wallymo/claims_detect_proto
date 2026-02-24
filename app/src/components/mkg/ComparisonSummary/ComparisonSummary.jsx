import styles from './ComparisonSummary.module.css'
import Icon from '@/components/atoms/Icon/Icon'
import Spinner from '@/components/atoms/Spinner/Spinner'

export default function ComparisonSummary({
  baselineClaimCount,
  trainedClaimCount,
  baselineClaims = [],
  trainedClaims = [],
  isLoading = false,
  onDismiss
}) {
  const fallbackBaselineCount = Array.isArray(baselineClaims) ? baselineClaims.length : 0
  const fallbackTrainedCount = Array.isArray(trainedClaims) ? trainedClaims.length : 0

  const resolvedBaselineCount = Number.isFinite(baselineClaimCount)
    ? baselineClaimCount
    : fallbackBaselineCount
  const resolvedTrainedCount = Number.isFinite(trainedClaimCount)
    ? trainedClaimCount
    : fallbackTrainedCount

  if (isLoading) {
    return (
      <div className={styles.loading} role="status" aria-live="polite">
        <Spinner size="small" label="Re-analyzing without training data..." />
        <span>Re-analyzing without training data...</span>
      </div>
    )
  }

  if (!Number.isFinite(baselineClaimCount)) return null

  const delta = resolvedTrainedCount - resolvedBaselineCount
  const percentChange = Math.round((delta / Math.max(resolvedBaselineCount, 1)) * 100)
  const deltaPrefix = delta > 0 ? '+' : ''
  const percentPrefix = percentChange > 0 ? '+' : ''
  const deltaClassName = [
    styles.delta,
    delta > 0 ? styles.positive : '',
    delta < 0 ? styles.negative : ''
  ].filter(Boolean).join(' ')

  return (
    <div className={styles.container}>
      <button
        type="button"
        className={styles.dismissBtn}
        onClick={onDismiss}
        aria-label="Dismiss comparison summary"
      >
        <Icon name="x" size={14} />
      </button>

      <div className={styles.title}>
        <Icon name="gitCompare" size={14} />
        <span>Training Impact Comparison</span>
      </div>

      <p className={styles.line}>Without training: {resolvedBaselineCount} claims detected</p>
      <p className={styles.line}>
        With training: {resolvedTrainedCount} claims detected (
        <span className={deltaClassName}>
          {deltaPrefix}{delta} claims, {percentPrefix}{percentChange}%
        </span>
        )
      </p>
    </div>
  )
}
