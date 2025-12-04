import styles from './Button.module.css'

export default function Button({
  children = 'Button',
  variant = 'primary',
  size = 'medium',
  disabled = false,
  type = 'button',
  onClick
}) {
  const className = [
    styles.button,
    styles[variant],
    styles[size],
    disabled ? styles.disabled : ''
  ].filter(Boolean).join(' ')

  return (
    <button
      className={className}
      type={type}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
