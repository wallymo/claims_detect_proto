import { useState } from 'react'
import styles from './Alert.module.css'
import Icon from '@/components/atoms/Icon/Icon'
import Button from '@/components/atoms/Button/Button'
import CloseButton from '@/components/atoms/CloseButton/CloseButton'

export default function Alert({
  type = 'info',
  title,
  message = 'This is an alert message.',
  dismissible = true,
  action,
  actionLabel = 'Action',
  layout = 'inline',
  size = 'medium',
  onDismiss,
  onAction,
  className
}) {
  const [isVisible, setIsVisible] = useState(true)

  if (!isVisible) return null

  const combinedClassName = [
    styles.alert,
    styles[type],
    styles[layout],
    styles[size],
    className
  ].filter(Boolean).join(' ')

  const handleDismiss = () => {
    setIsVisible(false)
    onDismiss?.()
  }

  const getIcon = () => {
    switch (type) {
      case 'success':
        return 'check'
      case 'warning':
        return 'alertTriangle'
      case 'error':
        return 'alertCircle'
      case 'info':
      default:
        return 'info'
    }
  }

  return (
    <div className={combinedClassName} role="alert">
      <span className={styles.icon}>
        <Icon name={getIcon()} size={size === 'small' ? 16 : 20} />
      </span>

      <div className={styles.content}>
        {title && <div className={styles.title}>{title}</div>}
        <div className={styles.message}>{message}</div>
      </div>

      <div className={styles.actions}>
        {action && (
          <Button
            variant="secondary"
            size="small"
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        )}

        {dismissible && (
          <CloseButton
            size="small"
            onClick={handleDismiss}
            aria-label="Dismiss alert"
          />
        )}
      </div>
    </div>
  )
}
