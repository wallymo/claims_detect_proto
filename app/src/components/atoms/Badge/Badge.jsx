import styles from './Badge.module.css'

export default function Badge({
  children = 'Badge',
  variant = 'default',
  shape = 'pill',
  size = 'medium',
  className
}) {
  const badgeClassName = [
    styles.badge,
    styles[variant],
    styles[shape],
    styles[size],
    className
  ].filter(Boolean).join(' ')

  return (
    <span className={badgeClassName}>
      {children}
    </span>
  )
}
