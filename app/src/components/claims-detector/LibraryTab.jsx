import { useState, useRef, useEffect } from 'react'
import styles from './LibraryTab.module.css'
import Button from '@/components/atoms/Button/Button'
import Icon from '@/components/atoms/Icon/Icon'
import Input from '@/components/atoms/Input/Input'
import Spinner from '@/components/atoms/Spinner/Spinner'
import ReferenceListItem from '@/components/claims-detector/ReferenceListItem'

export default function LibraryTab({
  documents = [],
  folders = [],
  activeFolderId = null,
  selectedBrand = null,
  onFolderSelect,
  onFolderCreate,
  onFolderDelete,
  onFolderRename,
  onUpload,
  onRename,
  onDelete,
  onBulkDelete,
  onBulkMove,
  onView,
  onRetryIndex,
  isLoading = false,
  isUploading = false
}) {
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [treeOpen, setTreeOpen] = useState(true)
  const [renamingFolderId, setRenamingFolderId] = useState(null)
  const [renameFolderName, setRenameFolderName] = useState('')
  const fileInputRef = useRef(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveCreating, setMoveCreating] = useState(false)
  const [moveNewName, setMoveNewName] = useState('')
  const moveRef = useRef(null)

  // Close popover on outside click
  useEffect(() => {
    if (!moveOpen) return
    const handler = (e) => {
      if (moveRef.current && !moveRef.current.contains(e.target)) {
        setMoveOpen(false)
        setMoveCreating(false)
        setMoveNewName('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [moveOpen])

  // Selection handlers
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredDocs.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredDocs.map(d => d.id)))
    }
  }

  const clearSelection = () => setSelectedIds(new Set())

  // Folder filtering
  const filteredDocs = activeFolderId
    ? documents.filter(d => d.folder_id === activeFolderId)
    : documents

  // Instant multi-file upload
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    for (const file of files) {
      onUpload?.(file)
    }
    e.target.value = ''
  }

  // Bulk actions
  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!window.confirm(`Delete ${ids.length} document${ids.length > 1 ? 's' : ''}?`)) return
    onBulkDelete?.(ids)
    clearSelection()
  }

  const handleBulkMove = (folderId) => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    onBulkMove?.(ids, folderId)
    clearSelection()
  }

  // Folder creation
  const handleCreateFolder = () => {
    const name = newFolderName.trim()
    if (!name) return
    onFolderCreate?.(name)
    setNewFolderName('')
    setIsCreatingFolder(false)
  }

  const handleFolderKeyDown = (e) => {
    if (e.key === 'Enter') handleCreateFolder()
    if (e.key === 'Escape') {
      setIsCreatingFolder(false)
      setNewFolderName('')
    }
  }

  // Folder rename
  const startRenaming = (folder) => {
    setRenamingFolderId(folder.id)
    setRenameFolderName(folder.name)
  }

  const handleRenameFolder = () => {
    const name = renameFolderName.trim()
    if (!name || !renamingFolderId) {
      setRenamingFolderId(null)
      return
    }
    onFolderRename?.(renamingFolderId, name)
    setRenamingFolderId(null)
    setRenameFolderName('')
  }

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') handleRenameFolder()
    if (e.key === 'Escape') {
      setRenamingFolderId(null)
      setRenameFolderName('')
    }
  }

  const hasSelection = selectedIds.size > 0
  const allSelected = filteredDocs.length > 0 && selectedIds.size === filteredDocs.length

  return (
    <div className={styles.libraryTab}>
      {/* Header + folder tree only when brand is selected */}
      {selectedBrand && (
        <>
          {/* Header: count + upload */}
          <div className={styles.libraryHeader}>
            <span className={styles.libraryCount}>{filteredDocs.length} documents</span>
            <div className={styles.headerActions}>
              {isUploading && <Spinner size="small" />}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc"
                multiple
                onChange={handleFileChange}
                hidden
              />
              <Button
                variant="primary"
                size="small"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                <Icon name="upload" size={14} />
                Upload
              </Button>
            </div>
          </div>

          {/* Folder tree */}
          <div className={styles.folderTree}>
        {/* Root: "All files" */}
        <button
          className={`${styles.treeRoot} ${activeFolderId === null ? styles.treeRootActive : ''}`}
          onClick={() => onFolderSelect?.(null)}
        >
          <span className={styles.treeRootIcon}>
            <Icon name="folder" size={18} />
          </span>
          <span className={styles.treeRootLabel}>All files</span>
          <span className={styles.treeRootActions}>
            <span
              className={styles.treeActionBtn}
              onClick={(e) => {
                e.stopPropagation()
                setIsCreatingFolder(true)
                if (!treeOpen) setTreeOpen(true)
              }}
              title="New folder"
            >
              <Icon name="plus" size={14} />
            </span>
            <span
              className={styles.treeActionBtn}
              onClick={(e) => {
                e.stopPropagation()
                setTreeOpen(prev => !prev)
              }}
              title={treeOpen ? 'Collapse' : 'Expand'}
            >
              <span className={`${styles.treeChevron} ${treeOpen ? styles.treeChevronOpen : styles.treeChevronClosed}`}>
                <Icon name="chevronDown" size={14} />
              </span>
            </span>
          </span>
        </button>

        {/* Child folders */}
        {treeOpen && (folders.length > 0 || isCreatingFolder) && (
          <div className={styles.treeChildren}>
            {folders.map(folder => (
              <div
                key={folder.id}
                className={`${styles.treeFolder} ${activeFolderId === folder.id ? styles.treeFolderActive : ''}`}
                onClick={() => onFolderSelect?.(folder.id)}
              >
                {renamingFolderId === folder.id ? (
                  <div className={styles.treeRenameRow} onClick={(e) => e.stopPropagation()}>
                    <Input
                      value={renameFolderName}
                      onChange={(e) => setRenameFolderName(e.target.value)}
                      onKeyDown={handleRenameKeyDown}
                      onBlur={handleRenameFolder}
                      size="small"
                      autoFocus
                    />
                  </div>
                ) : (
                  <>
                    <span className={styles.treeFolderName}>
                      {folder.name}
                      {folder.document_count > 0 && (
                        <span className={styles.treeFolderCount}> ({folder.document_count})</span>
                      )}
                    </span>
                    <span className={styles.treeFolderActions}>
                      <span
                        className={styles.treeFolderAction}
                        onClick={(e) => {
                          e.stopPropagation()
                          startRenaming(folder)
                        }}
                        title="Rename folder"
                      >
                        <Icon name="pencil" size={12} />
                      </span>
                      <span
                        className={styles.treeFolderAction}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (window.confirm(`Delete folder "${folder.name}"?`)) {
                            onFolderDelete?.(folder.id)
                          }
                        }}
                        title="Delete folder"
                      >
                        <Icon name="trash" size={12} />
                      </span>
                    </span>
                  </>
                )}
              </div>
            ))}

            {isCreatingFolder && (
              <div className={styles.treeNewFolder}>
                <Input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={handleFolderKeyDown}
                  placeholder="Folder name"
                  size="small"
                  autoFocus
                />
                <button className={styles.folderAction} onClick={handleCreateFolder}>
                  <Icon name="check" size={12} />
                </button>
                <button className={styles.folderAction} onClick={() => { setIsCreatingFolder(false); setNewFolderName('') }}>
                  <Icon name="x" size={12} />
                </button>
              </div>
            )}
          </div>
        )}
          </div>

          {/* Bulk action bar */}
          {hasSelection && (
            <div className={styles.bulkBar}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className={styles.bulkCheckbox}
              />
          <span className={styles.bulkCount}>{selectedIds.size} selected</span>
          <div className={styles.bulkActions}>
            <div className={styles.moveDropdown} ref={moveRef}>
              <button
                className={styles.moveBtn}
                onClick={() => {
                  setMoveOpen(prev => !prev)
                  setMoveCreating(false)
                  setMoveNewName('')
                }}
              >
                <Icon name="folder" size={14} />
                Move to...
                <Icon name="chevronDown" size={12} />
              </button>
              {moveOpen && (
                <div className={styles.movePopover}>
                  <button
                    className={styles.moveItem}
                    onClick={() => {
                      handleBulkMove(null)
                      setMoveOpen(false)
                    }}
                  >
                    All files
                  </button>
                  {folders.map(f => (
                    <button
                      key={f.id}
                      className={styles.moveItem}
                      onClick={() => {
                        handleBulkMove(f.id)
                        setMoveOpen(false)
                      }}
                    >
                      {f.name}
                    </button>
                  ))}
                  <div className={styles.moveDivider} />
                  {moveCreating ? (
                    <div className={styles.moveNewRow}>
                      <Input
                        value={moveNewName}
                        onChange={(e) => setMoveNewName(e.target.value)}
                        placeholder="Folder name"
                        size="small"
                        autoFocus
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            const name = moveNewName.trim()
                            if (!name) return
                            const folder = await onFolderCreate?.(name)
                            if (folder?.id) {
                              handleBulkMove(folder.id)
                            }
                            setMoveOpen(false)
                            setMoveCreating(false)
                            setMoveNewName('')
                          }
                          if (e.key === 'Escape') {
                            setMoveCreating(false)
                            setMoveNewName('')
                          }
                        }}
                      />
                      <button
                        className={styles.folderAction}
                        onClick={async () => {
                          const name = moveNewName.trim()
                          if (!name) return
                          const folder = await onFolderCreate?.(name)
                          if (folder?.id) {
                            handleBulkMove(folder.id)
                          }
                          setMoveOpen(false)
                          setMoveCreating(false)
                          setMoveNewName('')
                        }}
                      >
                        <Icon name="check" size={12} />
                      </button>
                      <button
                        className={styles.folderAction}
                        onClick={() => {
                          setMoveCreating(false)
                          setMoveNewName('')
                        }}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </div>
                  ) : (
                    <button
                      className={`${styles.moveItem} ${styles.moveNewFolder}`}
                      onClick={() => setMoveCreating(true)}
                    >
                      <Icon name="plus" size={14} />
                      New folder
                    </button>
                  )}
                </div>
              )}
            </div>
            <button className={styles.bulkDeleteBtn} onClick={handleBulkDelete}>
              <Icon name="x" size={14} />
              Delete
            </button>
          </div>
        </div>
          )}
        </>
      )}

      {/* Document list */}
      {isLoading ? (
        <div className={styles.libraryEmpty}>
          <Spinner size="large" />
          <p>Loading library...</p>
        </div>
      ) : !selectedBrand ? (
        <div className={styles.libraryEmpty}>
          <Icon name="folder" size={48} />
          <h3>Select a Brand</h3>
          <p>Choose a brand from Settings to load its reference library. References are used during analysis to identify and match claims.</p>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className={styles.libraryEmpty}>
          <Icon name="upload" size={48} />
          <h3>No References for {selectedBrand.name}</h3>
          <p>Upload reference documents like Prescribing Information, clinical studies, and supporting materials. These references power claim detection and matching — the more you add, the smarter the analysis.</p>
        </div>
      ) : (
        <div className={styles.libraryList}>
          {filteredDocs.map((doc) => (
            <ReferenceListItem
              key={doc.id}
              document={doc}
              selected={selectedIds.has(doc.id)}
              onSelect={toggleSelect}
              onView={onView}
              onRename={(newName) => onRename?.(doc.id, newName)}
              onDelete={() => onDelete?.(doc.id)}
              onRetryIndex={() => onRetryIndex?.(doc.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
