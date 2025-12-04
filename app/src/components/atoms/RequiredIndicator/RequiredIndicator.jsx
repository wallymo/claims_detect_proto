import styles from './RequiredIndicator.module.css'

export default function RequiredIndicator({
  variant = 'asterisk',
  className
}) {
  const combinedClassName = [
    styles.indicator,
    styles[variant],
    className
  ].filter(Boolean).join(' ')

  const content = variant === 'asterisk' ? '*' : '(required)'

  return (
    <span
      className={combinedClassName}
      aria-label="required"
    >
      {content}
    </span>
  )
}
