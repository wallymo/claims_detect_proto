import styles from './ProgressBar.module.css'

export default function ProgressBar({
  value,
  max = 100,
  size = 'medium',
  variant = 'default',
  showLabel = false,
  label,
  className
}) {
  // Clamp value between 0 and max
  const clampedValue = Math.max(0, Math.min(value, max))
  const percentage = (clampedValue / max) * 100

  const containerClassName = [
    styles.container,
    styles[size],
    className
  ].filter(Boolean).join(' ')

  const fillClassName = [
    styles.fill,
    styles[variant]
  ].filter(Boolean).join(' ')

  const ariaLabel = label || `${Math.round(percentage)}%`

  return (
    <div className={styles.wrapper}>
      <div
        className={containerClassName}
        role="progressbar"
        aria-valuenow={clampedValue}
        aria-valuemin="0"
        aria-valuemax={max}
        aria-label={ariaLabel}
      >
        <div
          className={fillClassName}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showLabel && (
        <div className={styles.label}>
          {label || `${Math.round(percentage)}%`}
        </div>
      )}
    </div>
  )
}
