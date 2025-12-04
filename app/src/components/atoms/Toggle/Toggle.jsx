import { useState } from 'react'
import styles from './Toggle.module.css'

export default function Toggle({
  checked = false,
  size = 'medium',
  disabled = false,
  onChange,
  label = '',
  id,
  name,
  'aria-label': ariaLabel
}) {
  const [isChecked, setIsChecked] = useState(checked)

  const handleChange = (e) => {
    if (!disabled) {
      const newChecked = e.target.checked
      setIsChecked(newChecked)
      if (onChange) {
        onChange(e)
      }
    }
  }

  const toggleClassName = [
    styles.toggle,
    styles[size],
    isChecked ? styles.on : styles.off,
    disabled ? styles.disabled : ''
  ].filter(Boolean).join(' ')

  const thumbClassName = [
    styles.thumb,
    styles[`thumb${size.charAt(0).toUpperCase() + size.slice(1)}`]
  ].filter(Boolean).join(' ')

  const toggleId = id || name || `toggle-${Math.random().toString(36).substr(2, 9)}`

  return (
    <label className={styles.container}>
      <input
        id={toggleId}
        name={name}
        type="checkbox"
        className={styles.input}
        checked={isChecked}
        disabled={disabled}
        onChange={handleChange}
        aria-label={ariaLabel || label}
        role="switch"
        aria-checked={isChecked}
      />
      <span className={toggleClassName}>
        <span className={thumbClassName} />
      </span>
      {label && (
        <span className={[
          styles.label,
          disabled ? styles.labelDisabled : ''
        ].filter(Boolean).join(' ')}>
          {label}
        </span>
      )}
    </label>
  )
}
