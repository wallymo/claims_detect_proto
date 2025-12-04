import styles from './FormField.module.css'
import Input from '@/components/atoms/Input/Input'
import Label from '@/components/atoms/Label/Label'
import HelperText from '@/components/atoms/HelperText/HelperText'
import ErrorMessage from '@/components/atoms/ErrorMessage/ErrorMessage'
import RequiredIndicator from '@/components/atoms/RequiredIndicator/RequiredIndicator'

export default function FormField({
  label,
  type = 'text',
  placeholder,
  value,
  onChange,
  helperText,
  errorMessage,
  required = false,
  disabled = false,
  id,
  className
}) {
  const fieldId = id || `field-${label?.toLowerCase().replace(/\s+/g, '-')}`
  const hasError = Boolean(errorMessage)

  const combinedClassName = [
    styles.formField,
    hasError ? styles.hasError : '',
    disabled ? styles.disabled : '',
    className
  ].filter(Boolean).join(' ')

  return (
    <div className={combinedClassName}>
      {label && (
        <Label htmlFor={fieldId} disabled={disabled}>
          {label}
          {required && <RequiredIndicator />}
        </Label>
      )}
      <Input
        id={fieldId}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        disabled={disabled}
        state={hasError ? 'error' : 'default'}
        aria-describedby={
          helperText ? `${fieldId}-helper` : errorMessage ? `${fieldId}-error` : undefined
        }
        aria-invalid={hasError}
        required={required}
      />
      {helperText && !hasError && (
        <HelperText id={`${fieldId}-helper`} disabled={disabled}>
          {helperText}
        </HelperText>
      )}
      {hasError && (
        <ErrorMessage id={`${fieldId}-error`}>
          {errorMessage}
        </ErrorMessage>
      )}
    </div>
  )
}
