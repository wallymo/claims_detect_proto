import styles from './DocumentTypeSelector.module.css'
import DropdownMenu from '@/components/molecules/DropdownMenu/DropdownMenu'

const DOCUMENT_TYPES = [
  { id: 'global', label: 'Global' },
  { id: 'unmet-needs', label: 'Unmet Needs' },
  { id: 'trifold', label: 'Trifold' },
  { id: 'sales-deck', label: 'Sales Deck' },
  { id: 'new-library', label: '+ New Library' }
]

export default function DocumentTypeSelector({
  selectedType = null,
  onTypeSelect,
  disabled = false
}) {
  const selectedLabel = DOCUMENT_TYPES.find((type) => type.id === selectedType)?.label

  return (
    <div className={styles.documentTypeSelector}>
      <label className="settingLabel">Reference Library</label>
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
