import styles from './ProgressRing.module.css'

export default function ProgressRing({
  percentage = 0,
  size = 120,
  strokeWidth = 8,
  showComplete = false
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (percentage / 100) * circumference

  return (
    <div className={styles.progressRing} style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        {/* Background circle */}
        <circle
          className={styles.bgCircle}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          className={`${styles.progressCircle} ${showComplete ? styles.complete : ''}`}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className={styles.label}>
        {showComplete ? (
          <span className={styles.checkmark}>✓</span>
        ) : (
          <span className={styles.percentage}>{Math.round(percentage)}%</span>
        )}
      </div>
    </div>
  )
}
