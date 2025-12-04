import styles from './CloseButton.module.css'

export default function CloseButton({
  size = 'medium',
  onClick,
  disabled = false,
  'aria-label': ariaLabel = 'Close',
  className
}) {
  const combinedClassName = [
    styles.closeButton,
    styles[size],
    disabled ? styles.disabled : '',
    className
  ].filter(Boolean).join(' ')

  return (
    <button
      className={combinedClassName}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      type="button"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  )
}
