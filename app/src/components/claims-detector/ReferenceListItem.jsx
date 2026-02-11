import { useState } from 'react'
import styles from './ReferenceListItem.module.css'
import Icon from '@/components/atoms/Icon/Icon'
import Input from '@/components/atoms/Input/Input'
import Button from '@/components/atoms/Button/Button'

export default function ReferenceListItem({
  document,
  onRename,
  onDelete,
  onView,
  onRetryIndex,
  selected,
  onSelect
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(document.name)

  const handleStartEdit = () => {
    setEditName(document.name)
    setIsEditing(true)
  }

  const handleSave = () => {
    const nextName = editName.trim()
    if (!nextName) {
      setEditName(document.name)
      setIsEditing(false)
      return
    }
    if (nextName !== document.name) {
      onRename?.(nextName)
    }
    setIsEditing(false)
  }

  const handleCancel = () => {
    setEditName(document.name)
    setIsEditing(false)
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleSave()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancel()
    }
  }

  const itemClassName = [
    styles.listItem,
    isEditing ? styles.editing : '',
    selected ? styles.selected : ''
  ].filter(Boolean).join(' ')

  return (
    <div className={itemClassName}>
      <input
        type="checkbox"
        className={styles.selectCheckbox}
        checked={selected}
        onChange={() => onSelect?.(document.id)}
      />
      <div className={styles.itemIcon} onClick={() => onView?.(document.id)} style={{ cursor: 'pointer' }} title="View document">
        <Icon name="eye" size={20} />
      </div>
      <div className={styles.itemContent}>
        {isEditing ? (
          <div className={styles.editRow} onKeyDown={handleKeyDown}>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              size="small"
              autoFocus
            />
            <Button variant="ghost" size="small" onClick={handleSave}>
              <Icon name="check" size={14} />
            </Button>
            <Button variant="ghost" size="small" onClick={handleCancel}>
              <Icon name="x" size={14} />
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={() => setEditName(document.originalName || document.name)}
              title="Reset to original filename"
              disabled={editName === (document.originalName || document.name)}
            >
              <Icon name="refreshCw" size={14} />
            </Button>
          </div>
        ) : (
          <>
            <div className={styles.nameRow}>
              <span
                className={styles.itemName}
                onClick={handleStartEdit}
                title="Click to rename"
              >{document.name}</span>
            </div>
            <span className={styles.itemMeta}>
              {document.size} &middot; {document.uploadedAt}
              {(document.extraction_status === 'pending' || document.extraction_status === 'extracting') && (
                <span className={styles.indexingBadge}>Indexing...</span>
              )}
              {document.extraction_status === 'failed' && (
                <button
                  className={styles.failedBadge}
                  onClick={(e) => { e.stopPropagation(); onRetryIndex?.() }}
                  title="Retry fact indexing"
                >
                  Index failed <Icon name="refreshCw" size={10} />
                </button>
              )}
            </span>
          </>
        )}
      </div>
      {!isEditing && (
        <button
          className={styles.deleteBtn}
          onClick={() => {
            if (window.confirm(`Delete "${document.name}"?`)) {
              onDelete?.()
            }
          }}
          title="Delete document"
        >
          <Icon name="trash" size={14} />
        </button>
      )}
    </div>
  )
}
