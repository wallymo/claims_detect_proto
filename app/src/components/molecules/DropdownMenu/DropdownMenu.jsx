import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
  className,
  disabled = false
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState({})
  const dropdownRef = useRef(null)
  const triggerRef = useRef(null)

  const combinedClassName = [
    styles.dropdown,
    styles[size],
    className
  ].filter(Boolean).join(' ')

  // Calculate menu position from trigger button's viewport rect
  const updateMenuPosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const style = {}

    if (position === 'bottom-left' || position === 'bottom-right') {
      style.top = rect.bottom + 4
    } else {
      style.bottom = window.innerHeight - rect.top + 4
    }

    if (position === 'bottom-left' || position === 'top-left') {
      style.left = rect.left
    } else {
      style.right = window.innerWidth - rect.right
    }

    // Match trigger width as minimum
    style.minWidth = Math.max(rect.width, 180)

    setMenuStyle(style)
  }, [position])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        // Also check if click is inside the portal menu
        const portalMenu = document.getElementById('dropdown-portal-menu')
        if (portalMenu && portalMenu.contains(event.target)) return
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Recalculate position on scroll/resize while open
  useEffect(() => {
    if (!isOpen) return
    updateMenuPosition()

    const handleScrollOrResize = () => updateMenuPosition()
    window.addEventListener('scroll', handleScrollOrResize, true)
    window.addEventListener('resize', handleScrollOrResize)
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [isOpen, updateMenuPosition])

  useEffect(() => {
    if (disabled) {
      setIsOpen(false)
    }
  }, [disabled])

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const handleItemClick = (item) => {
    item.onClick?.()
    setIsOpen(false)
  }

  const handleToggle = () => {
    if (disabled) return
    if (!isOpen) updateMenuPosition()
    setIsOpen(!isOpen)
  }

  const renderTrigger = () => {
    if (trigger === 'icon') {
      const iconTriggerClassName = [
        styles.iconTrigger,
        disabled ? styles.iconTriggerDisabled : ''
      ].filter(Boolean).join(' ')

      return (
        <button
          className={iconTriggerClassName}
          onClick={handleToggle}
          aria-expanded={isOpen}
          aria-haspopup="true"
          disabled={disabled}
        >
          <Icon name="moreVertical" size={20} />
        </button>
      )
    }

    return (
      <Button
        variant="secondary"
        size={size}
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-haspopup="true"
        disabled={disabled}
      >
        {triggerLabel}
        <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} size={16} />
      </Button>
    )
  }

  return (
    <div className={combinedClassName} ref={(el) => { dropdownRef.current = el; triggerRef.current = el }} onKeyDown={handleKeyDown}>
      {renderTrigger()}

      {isOpen && createPortal(
        <div
          id="dropdown-portal-menu"
          className={styles.portalMenu}
          style={menuStyle}
          role="menu"
        >
          {items.map((item, index) => (
            item.divider ? (
              <div key={index} className={styles.divider} />
            ) : (
              <MenuItem
                key={index}
                icon={item.icon}
                iconColor={item.iconColor}
                disabled={item.disabled}
                onClick={() => handleItemClick(item)}
              >
                {item.label}
              </MenuItem>
            )
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
