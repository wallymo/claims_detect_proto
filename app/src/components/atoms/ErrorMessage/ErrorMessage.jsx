import styles from './ErrorMessage.module.css'
import Icon from '@/components/atoms/Icon/Icon'

export default function ErrorMessage({
  children = 'Error message',
  showIcon = true,
  className
}) {
  const combinedClassName = [
    styles.error,
    className
  ].filter(Boolean).join(' ')

  return (
    <div className={combinedClassName} role="alert">
      {showIcon && (
        <span className={styles.icon}>
          <Icon name="alertCircle" size={14} />
        </span>
      )}
      <span className={styles.message}>{children}</span>
    </div>
  )
}
