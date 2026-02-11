import { useEffect, useRef, useState } from 'react'
import styles from './ReferenceUploadForm.module.css'
import FileUpload from '@/components/molecules/FileUpload/FileUpload'
import Input from '@/components/atoms/Input/Input'
import Button from '@/components/atoms/Button/Button'
import Icon from '@/components/atoms/Icon/Icon'
import DropdownMenu from '@/components/molecules/DropdownMenu/DropdownMenu'
import Spinner from '@/components/atoms/Spinner/Spinner'

const DOC_TYPE_OPTIONS = [
  { id: 'PI', label: 'Prescribing Info (PI)' },
  { id: 'clinical_trial', label: 'Clinical Trial' },
  { id: 'journal', label: 'Journal Article' },
  { id: 'guideline', label: 'Guideline' },
  { id: 'internal', label: 'Internal Doc' },
  { id: 'other', label: 'Other' }
]

const DOC_TYPE_LABELS = Object.fromEntries(DOC_TYPE_OPTIONS.map((option) => [option.id, option.label]))

export default function ReferenceUploadForm({
  brands,
  selectedBrand,
  onUpload,
  onCancel,
  isUploading = false
}) {
  const isBrandMode = Array.isArray(brands)
  const [file, setFile] = useState(null)
  const [displayAlias, setDisplayAlias] = useState('')
  const [docType, setDocType] = useState('other')
  const [brandId, setBrandId] = useState(selectedBrand || '')
  const [notes, setNotes] = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!isBrandMode) return
    if (selectedBrand) {
      setBrandId(selectedBrand)
      return
    }
    if (!brandId && brands?.length) {
      setBrandId(brands[0].id)
    }
  }, [selectedBrand, brands, brandId, isBrandMode])

  const resetForm = () => {
    setFile(null)
    setDisplayAlias('')
    setDocType('other')
    setBrandId(selectedBrand || '')
    setNotes('')
  }

  const handleFileSelect = (event) => {
    const selectedFile = event.target.files?.[0]
    if (!selectedFile) return
    setFile(selectedFile)
  }

  const handleCancel = () => {
    resetForm()
    onCancel?.()
  }

  const handleSubmit = async () => {
    if (!file) return

    if (isBrandMode) {
      await onUpload?.(file, {
        brand_id: brandId || null,
        display_alias: displayAlias.trim() || file.name,
        doc_type: docType,
        notes: notes.trim()
      })
    } else {
      await onUpload?.(file, displayAlias.trim() || file.name)
    }
  }

  if (!isBrandMode) {
    return (
      <div className={styles.uploadForm}>
        <FileUpload
          accept=".pdf,.docx,.xlsx"
          maxSize={10485760}
          onUpload={(selectedFile) => {
            setFile(selectedFile)
            setDisplayAlias(selectedFile?.name || '')
          }}
          onRemove={resetForm}
          mockMode={true}
        />

        {file && (
          <div className={styles.uploadFields}>
            <Input
              label="Display Name"
              placeholder="e.g. CardioMax Clinical References"
              value={displayAlias}
              onChange={(event) => setDisplayAlias(event.target.value)}
              size="small"
            />
            <div className={styles.uploadActions}>
              <Button variant="secondary" size="small" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="small"
                onClick={handleSubmit}
                disabled={!displayAlias.trim()}
              >
                <Icon name="plus" size={14} />
                Add to Library
              </Button>
            </div>
          </div>
        )}

        {!file && (
          <div className={styles.uploadActions}>
            <Button variant="secondary" size="small" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    )
  }

  const brandLabel = brandId
    ? brands.find((brand) => brand.id === brandId)?.name
    : (brands.length ? 'Select Brand' : 'No Brands')

  const brandItems = brands.length
    ? brands.map((brand) => ({
        label: brand.name,
        onClick: () => setBrandId(brand.id)
      }))
    : [{ label: 'No brands available', disabled: true }]

  const canUpload = Boolean(file) && Boolean(brandId) && !isUploading

  return (
    <div className={styles.uploadForm}>
      <div className={styles.uploadFormHeader}>
        <h4>Upload Reference</h4>
        <button className={styles.closeBtn} onClick={handleCancel}>
          <Icon name="x" size={14} />
        </button>
      </div>

      <div className={styles.uploadFormBody}>
        <div className={styles.filePicker}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileSelect}
            hidden
          />
          {file ? (
            <div className={styles.selectedFile}>
              <Icon name="fileText" size={16} />
              <span>{file.name}</span>
              <button onClick={() => setFile(null)}>
                <Icon name="x" size={12} />
              </button>
            </div>
          ) : (
            <button
              className={styles.pickFileBtn}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="upload" size={16} />
              Choose PDF
            </button>
          )}
        </div>

        <div className={styles.fieldRow}>
          <Input
            placeholder="Display name (optional)"
            size="small"
            value={displayAlias}
            onChange={(event) => setDisplayAlias(event.target.value)}
          />
          <DropdownMenu
            trigger="button"
            triggerLabel={DOC_TYPE_LABELS[docType] || 'Type'}
            items={DOC_TYPE_OPTIONS.map((option) => ({
              label: option.label,
              onClick: () => setDocType(option.id)
            }))}
            size="small"
          />
          <DropdownMenu
            trigger="button"
            triggerLabel={brandLabel}
            items={brandItems}
            size="small"
          />
        </div>

        <div className={styles.submitRow}>
          <Button variant="secondary" size="small" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="small"
            onClick={handleSubmit}
            disabled={!canUpload}
          >
            {isUploading ? (
              <>
                <Spinner size="small" />
                Uploading...
              </>
            ) : (
              'Upload'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
