import { useState, useRef } from 'react'
import styles from './FileUpload.module.css'
import Icon from '@/components/atoms/Icon/Icon'
import Button from '@/components/atoms/Button/Button'
import ProgressBar from '@/components/atoms/ProgressBar/ProgressBar'

export default function FileUpload({
  accept = '*',
  maxSize = 10485760, // 10MB
  multiple = false,
  onUpload,
  uploadProgress,
  state = 'empty',
  size = 'medium',
  className,
  mockMode = false,
  mockFileName = 'Clinical_Trial_Summary.pdf'
}) {
  const [dragOver, setDragOver] = useState(false)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  const combinedClassName = [
    styles.fileUpload,
    styles[size],
    styles[state],
    dragOver ? styles.dragOver : '',
    className
  ].filter(Boolean).join(' ')

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const handleFile = (file) => {
    if (file.size > maxSize) {
      setError(`File size exceeds ${formatFileSize(maxSize)}`)
      return
    }

    setError('')
    setFileName(file.name)
    onUpload?.(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)

    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => {
    setDragOver(false)
  }

  const handleChange = (e) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const handleClick = () => {
    if (mockMode) {
      // Simulate upload without opening file picker
      setFileName(mockFileName)
      onUpload?.({ name: mockFileName, size: 1024000, type: 'application/pdf' })
      return
    }
    inputRef.current?.click()
  }

  const handleRemove = () => {
    setFileName('')
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div
      className={combinedClassName}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
        className={styles.input}
      />

      {state === 'empty' && !fileName && (
        <div className={styles.dropzone} onClick={handleClick}>
          <Icon name="upload" size={size === 'small' ? 24 : 32} />
          <div className={styles.text}>
            <span className={styles.primary}>Click to upload</span>
            <span className={styles.secondary}> or drag and drop</span>
          </div>
          <div className={styles.hint}>Max file size: {formatFileSize(maxSize)}</div>
        </div>
      )}

      {state === 'uploading' && (
        <div className={styles.uploading}>
          <div className={styles.fileInfo}>
            <Icon name="file" size={20} />
            <span className={styles.fileName}>{fileName}</span>
          </div>
          <ProgressBar value={uploadProgress} size="small" />
          <span className={styles.progress}>{uploadProgress}%</span>
        </div>
      )}

      {(state === 'complete' || (state === 'empty' && fileName)) && (
        <div className={styles.complete}>
          <div className={styles.fileInfo}>
            <Icon name="check" size={20} />
            <span className={styles.fileName}>{fileName}</span>
          </div>
          <Button variant="ghost" size="small" onClick={handleRemove}>
            <Icon name="x" size={16} />
          </Button>
        </div>
      )}

      {(state === 'error' || error) && (
        <div className={styles.errorState}>
          <Icon name="alertCircle" size={20} />
          <span className={styles.errorText}>{error || 'Upload failed'}</span>
          <Button variant="secondary" size="small" onClick={handleClick}>
            Try again
          </Button>
        </div>
      )}
    </div>
  )
}
