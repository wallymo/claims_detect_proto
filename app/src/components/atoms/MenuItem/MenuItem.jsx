import styles from './MenuItem.module.css'
import Icon from '@/components/atoms/Icon/Icon'

export default function MenuItem({
  children = 'Menu Item',
  icon,
  iconColor,
  shortcut,
  selected = false,
  disabled = false,
  onClick,
  className
}) {
  const combinedClassName = [
    styles.menuItem,
    selected ? styles.selected : '',
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
    <div
      className={combinedClassName}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="menuitem"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
    >
      {icon && (
        <span className={styles.icon}>
          <Icon name={icon} size={16} color={iconColor} />
        </span>
      )}
      <span className={styles.label}>{children}</span>
      {shortcut && (
        <span className={styles.shortcut}>{shortcut}</span>
      )}
    </div>
  )
}
