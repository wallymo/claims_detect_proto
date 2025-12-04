import { useEffect, useRef } from 'react'
import styles from './Checkbox.module.css'

export default function Checkbox({
  size = 'medium',
  checked = false,
  indeterminate = false,
  disabled = false,
  label = '',
  onChange,
  id,
  name,
  value,
  required = false,
  'aria-label': ariaLabel
}) {
  const checkboxRef = useRef(null)

  // Handle indeterminate state (can't be set via HTML attribute)
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = indeterminate
    }
  }, [indeterminate])

  const checkboxClassName = [
    styles.checkbox,
    styles[size],
    disabled ? styles.disabled : ''
  ].filter(Boolean).join(' ')

  const containerClassName = [
    styles.container,
    disabled ? styles.containerDisabled : ''
  ].filter(Boolean).join(' ')

  const checkboxId = id || name || `checkbox-${Math.random().toString(36).substr(2, 9)}`

  return (
    <div className={containerClassName}>
      <div className={styles.checkboxWrapper}>
        <input
          ref={checkboxRef}
          id={checkboxId}
          name={name}
          type="checkbox"
          className={checkboxClassName}
          checked={checked}
          disabled={disabled}
          required={required}
          value={value}
          onChange={onChange}
          aria-label={ariaLabel || label}
          aria-checked={indeterminate ? 'mixed' : checked}
        />
        <svg
          className={styles.checkmark}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {indeterminate ? (
            <path
              d="M6 12H18"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M5 13L9 17L19 7"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      </div>
      {label && (
        <label htmlFor={checkboxId} className={styles.label}>
          {label}
          {required && <span className={styles.required} aria-label="required">*</span>}
        </label>
      )}
    </div>
  )
}
