import styles from './HelperText.module.css'

export default function HelperText({
  children = 'Helper text',
  disabled = false,
  className
}) {
  const combinedClassName = [
    styles.helper,
    disabled ? styles.disabled : '',
    className
  ].filter(Boolean).join(' ')

  return (
    <div className={combinedClassName}>
      {children}
    </div>
  )
}
