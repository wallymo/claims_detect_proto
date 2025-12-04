import { useState } from 'react'
import styles from './AccordionItem.module.css'
import Icon from '@/components/atoms/Icon/Icon'

export default function AccordionItem({
  title = 'Accordion Title',
  content = 'Accordion content goes here. This can be any text or component.',
  defaultOpen = false,
  iconStyle = 'chevron',
  size = 'medium',
  disabled = false,
  className
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  const combinedClassName = [
    styles.accordion,
    styles[size],
    isOpen ? styles.open : '',
    disabled ? styles.disabled : '',
    className
  ].filter(Boolean).join(' ')

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen)
    }
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleToggle()
    }
  }

  const getIcon = () => {
    if (iconStyle === 'plusMinus') {
      return isOpen ? 'minus' : 'plus'
    }
    return isOpen ? 'chevronUp' : 'chevronDown'
  }

  return (
    <div className={combinedClassName}>
      <button
        className={styles.header}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        aria-expanded={isOpen}
        aria-controls="accordion-content"
        disabled={disabled}
      >
        <span className={styles.title}>{title}</span>
        <span className={styles.icon}>
          <Icon name={getIcon()} size={size === 'small' ? 16 : 20} />
        </span>
      </button>

      <div
        id="accordion-content"
        className={styles.content}
        role="region"
        hidden={!isOpen}
      >
        <div className={styles.contentInner}>
          {content}
        </div>
      </div>
    </div>
  )
}
