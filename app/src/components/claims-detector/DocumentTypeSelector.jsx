import styles from './DocumentTypeSelector.module.css'
import DropdownMenu from '@/components/molecules/DropdownMenu/DropdownMenu'

const DOCUMENT_TYPES = [
  { id: 'speaker-notes', label: 'Speaker Notes' },
  { id: 'trifold', label: 'TriFold' },
  { id: 'slides-only', label: 'Slides Only' }
]

export default function DocumentTypeSelector({
  selectedType = null,
  onTypeSelect,
  disabled = false
}) {
  const selectedLabel = DOCUMENT_TYPES.find((type) => type.id === selectedType)?.label

  return (
    <div className={styles.documentTypeSelector}>
      <label className="settingLabel">Document Type</label>
      <DropdownMenu
        trigger="button"
        triggerLabel={selectedLabel || 'Select type...'}
        items={DOCUMENT_TYPES.map((type) => ({
          label: type.label,
          onClick: () => onTypeSelect?.(type.id)
        }))}
        size="medium"
        disabled={disabled}
      />
    </div>
  )
}
