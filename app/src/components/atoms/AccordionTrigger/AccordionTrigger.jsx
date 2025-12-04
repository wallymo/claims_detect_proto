import styles from './AccordionTrigger.module.css'
import Icon from '@/components/atoms/Icon/Icon'

export default function AccordionTrigger({
  children = 'Accordion Item',
  expanded = false,
  disabled = false,
  onClick,
  className
}) {
  const combinedClassName = [
    styles.trigger,
    expanded ? styles.expanded : '',
    disabled ? styles.disabled : '',
    className
  ].filter(Boolean).join(' ')

  const handleClick = () => {
    if (!disabled && onClick) {
      onClick()
    }
  }

  const handleKeyDown = (e) => {
    if (!disabled && onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      onClick()
    }
  }

  return (
    <button
      className={combinedClassName}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      aria-expanded={expanded}
      aria-disabled={disabled}
      type="button"
    >
      <span className={styles.label}>{children}</span>
      <span className={styles.icon}>
        <Icon name="chevronDown" size={16} />
      </span>
    </button>
  )
}
