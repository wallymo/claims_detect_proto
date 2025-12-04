import { useState } from 'react'
import styles from './ToggleWithLabel.module.css'
import Toggle from '@/components/atoms/Toggle/Toggle'
import HelperText from '@/components/atoms/HelperText/HelperText'

export default function ToggleWithLabel({
  label = 'Enable feature',
  helperText,
  checked = false,
  onChange,
  labelPosition = 'right',
  size = 'medium',
  disabled = false,
  className
}) {
  const [isChecked, setIsChecked] = useState(checked)

  const combinedClassName = [
    styles.toggleWithLabel,
    styles[labelPosition],
    styles[size],
    disabled ? styles.disabled : '',
    className
  ].filter(Boolean).join(' ')

  const handleChange = () => {
    const newValue = !isChecked
    setIsChecked(newValue)
    onChange?.(newValue)
  }

  return (
    <div className={combinedClassName}>
      <label className={styles.container}>
        <Toggle
          checked={isChecked}
          onChange={handleChange}
          disabled={disabled}
          size={size}
        />
        <span className={styles.label}>{label}</span>
      </label>
      {helperText && (
        <HelperText disabled={disabled} className={styles.helper}>
          {helperText}
        </HelperText>
      )}
    </div>
  )
}
