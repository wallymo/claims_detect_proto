import styles from './Spinner.module.css'

export default function Spinner({
  size = 'medium',
  variant = 'circular',
  label = 'Loading...',
  className
}) {
  const spinnerClassName = [
    styles.spinner,
    styles[size],
    styles[variant],
    className
  ].filter(Boolean).join(' ')

  return (
    <div
      className={spinnerClassName}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {variant === 'circular' && (
        <div className={styles.circular} />
      )}
      {variant === 'dots' && (
        <div className={styles.dotsContainer}>
          <div className={styles.dot} />
          <div className={styles.dot} />
          <div className={styles.dot} />
        </div>
      )}
      {variant === 'bars' && (
        <div className={styles.barsContainer}>
          <div className={styles.bar} />
          <div className={styles.bar} />
          <div className={styles.bar} />
        </div>
      )}
      <span className={styles.visuallyHidden}>{label}</span>
    </div>
  )
}
