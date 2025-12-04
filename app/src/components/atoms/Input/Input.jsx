import styles from './Input.module.css'

export default function Input({
  type = 'text',
  size = 'medium',
  state = 'default',
  disabled = false,
  placeholder = '',
  value = '',
  label = '',
  helperText = '',
  onChange,
  onFocus,
  onBlur,
  id,
  name,
  required = false,
  'aria-label': ariaLabel
}) {
  const inputClassName = [
    styles.input,
    styles[size],
    styles[state],
    disabled ? styles.disabled : ''
  ].filter(Boolean).join(' ')

  const containerClassName = [
    styles.container,
    disabled ? styles.containerDisabled : ''
  ].filter(Boolean).join(' ')

  const inputId = id || name || `input-${Math.random().toString(36).substr(2, 9)}`

  return (
    <div className={containerClassName}>
      {label && (
        <label htmlFor={inputId} className={styles.label}>
          {label}
          {required && <span className={styles.required} aria-label="required">*</span>}
        </label>
      )}
      <input
        id={inputId}
        name={name}
        type={type}
        className={inputClassName}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        required={required}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        aria-label={ariaLabel || label || placeholder}
        aria-invalid={state === 'error'}
        aria-describedby={helperText ? `${inputId}-helper` : undefined}
      />
      {helperText && (
        <span
          id={`${inputId}-helper`}
          className={[
            styles.helperText,
            state === 'error' ? styles.helperError : '',
            state === 'success' ? styles.helperSuccess : ''
          ].filter(Boolean).join(' ')}
          role={state === 'error' ? 'alert' : undefined}
        >
          {helperText}
        </span>
      )}
    </div>
  )
}
