import styles from './TrainingStatusBanner.module.css'
import Icon from '@/components/atoms/Icon/Icon'

export default function TrainingStatusBanner({
  trainingExamples = [],
  ecosystemExampleCount = 0,
  ecosystemBrandCount = 0,
  trainingDocumentCount = 0,
  analysisComplete = false
}) {
  if (!analysisComplete) return null

  const examples = Array.isArray(trainingExamples) ? trainingExamples : []
  const hasNoTrainingData = examples.length === 0 && ecosystemExampleCount === 0

  if (hasNoTrainingData) {
    return (
      <div className={`${styles.banner} ${styles.noTraining}`} role="status">
        <div className={styles.mainLine}>
          <Icon name="info" size={14} className={styles.lineIcon} />
          <span>No training data &mdash; approve/reject claims to teach the system</span>
        </div>
      </div>
    )
  }

  let approved = 0
  let missed = 0
  let falsePositive = 0

  for (const example of examples) {
    if (example?.type === 'Claim') approved += 1
    else if (example?.type === 'MissedClaim') missed += 1
    else if (example?.type === 'FalsePositive') falsePositive += 1
  }

  const totalExamples = examples.length

  return (
    <div className={`${styles.banner} ${styles.hasTraining}`} role="status">
      <div className={styles.mainLine}>
        <Icon name="flask" size={14} className={styles.lineIcon} />
        <span>
          This analysis used {totalExamples} training example{totalExamples !== 1 ? 's' : ''} ({approved} approved, {missed} missed, {falsePositive} false-positive) from {trainingDocumentCount} document{trainingDocumentCount !== 1 ? 's' : ''}
        </span>
      </div>

      {ecosystemExampleCount > 0 && (
        <div className={styles.ecosystemLine}>
          <Icon name="gitCompare" size={12} className={styles.lineIcon} />
          <span>
            Including {ecosystemExampleCount} cross-brand example{ecosystemExampleCount !== 1 ? 's' : ''} from {ecosystemBrandCount} other brand{ecosystemBrandCount !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  )
}
