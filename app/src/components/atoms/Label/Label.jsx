import styles from './Label.module.css'

export default function Label({
  children = 'Label',
  variant = 'default',
  size = 'medium',
  htmlFor,
  required = false,
  disabled = false
}) {
  const className = [
    styles.label,
    styles[variant],
    styles[size],
    disabled ? styles.disabled : ''
  ].filter(Boolean).join(' ')

  return (
    <label
      className={className}
      htmlFor={htmlFor}
    >
      {children}
      {(required || variant === 'required') && (
        <span className={styles.requiredIndicator} aria-label="required">*</span>
      )}
    </label>
  )
}
