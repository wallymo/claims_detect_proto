import { useState, useRef, useEffect } from 'react'
import styles from './DropdownMenu.module.css'
import Button from '@/components/atoms/Button/Button'
import Icon from '@/components/atoms/Icon/Icon'
import MenuItem from '@/components/atoms/MenuItem/MenuItem'

export default function DropdownMenu({
  trigger = 'button',
  triggerLabel = 'Options',
  items = [
    { label: 'Edit', onClick: () => {} },
    { label: 'Duplicate', onClick: () => {} },
    { label: 'Delete', onClick: () => {} }
  ],
  position = 'bottom-left',
  size = 'medium',
  className
}) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef(null)

  const combinedClassName = [
    styles.dropdown,
    styles[size],
    className
  ].filter(Boolean).join(' ')

  const menuClassName = [
    styles.menu,
    styles[position]
  ].filter(Boolean).join(' ')

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const handleItemClick = (item) => {
    item.onClick?.()
    setIsOpen(false)
  }

  const renderTrigger = () => {
    if (trigger === 'icon') {
      return (
        <button
          className={styles.iconTrigger}
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          <Icon name="moreVertical" size={20} />
        </button>
      )
    }

    return (
      <Button
        variant="secondary"
        size={size}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        {triggerLabel}
        <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} size={16} />
      </Button>
    )
  }

  return (
    <div className={combinedClassName} ref={dropdownRef} onKeyDown={handleKeyDown}>
      {renderTrigger()}

      {isOpen && (
        <div className={menuClassName} role="menu">
          {items.map((item, index) => (
            item.divider ? (
              <div key={index} className={styles.divider} />
            ) : (
              <MenuItem
                key={index}
                label={item.label}
                icon={item.icon}
                disabled={item.disabled}
                onClick={() => handleItemClick(item)}
              />
            )
          ))}
        </div>
      )}
    </div>
  )
}
