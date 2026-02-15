# Soft Delete / Trash Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hard-delete with soft-delete for references. Deleted refs go to a Trash view in the Library tab, where users can restore or permanently delete them.

**Architecture:** Add a `deleted_at` column to `reference_documents`. Existing queries filter on `deleted_at IS NULL`. A new "Trash" entry in the folder tree shows soft-deleted refs with restore/permanent-delete actions. Backend gets three new endpoints for trash listing, restore, and permanent delete.

**Tech Stack:** SQLite migration (better-sqlite3), Express routes, React components (LibraryTab, ReferenceListItem), CSS Modules.

---

### Task 1: Database Migration

**Files:**
- Create: `backend/migrations/004_soft_delete.sql`

**Step 1: Create the migration file**

```sql
ALTER TABLE reference_documents ADD COLUMN deleted_at TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_refdocs_deleted_at ON reference_documents(deleted_at);
```

**Step 2: Verify migration runs on startup**

Restart backend:
```bash
cd /Users/wallymo/claims_detector/backend && npm run dev
```

Expected: Server starts without errors, "Database initialized" logged. Verify column exists:
```bash
cd /Users/wallymo/claims_detector/backend && node -e "
import { initDb, getDb, closeDb } from './src/config/database.js';
initDb();
const db = getDb();
const cols = db.prepare(\"PRAGMA table_info(reference_documents)\").all();
const hasDeletedAt = cols.some(c => c.name === 'deleted_at');
console.log('deleted_at column exists:', hasDeletedAt);
closeDb();
"
```

Expected: `deleted_at column exists: true`

**Step 3: Commit**

```bash
git add backend/migrations/004_soft_delete.sql
git commit -m "feat: add soft delete migration for reference_documents"
```

---

### Task 2: Model — Soft Delete & Restore Methods

**Files:**
- Modify: `backend/src/models/Reference.js`

**Step 1: Add `deleted_at IS NULL` filter to `findByBrand`**

In `Reference.findByBrand()` (line 31), change:

```javascript
      WHERE rd.brand_id = ?
```

to:

```javascript
      WHERE rd.brand_id = ? AND rd.deleted_at IS NULL
```

**Step 2: Add `findDeleted` method**

Add after `findByBrand`:

```javascript
  findDeleted(brandId) {
    const db = getDb()
    return db.prepare(`
      SELECT rd.id, rd.brand_id, rd.folder_id, rd.filename, rd.display_alias, rd.doc_type,
             rd.page_count, rd.file_size_bytes, rd.upload_date, rd.deleted_at, rd.notes,
             (rd.content_text IS NOT NULL) as has_content,
             rf.extraction_status,
             CASE WHEN rf.facts_json IS NOT NULL
               THEN json_array_length(rf.facts_json)
               ELSE 0
             END as facts_count
      FROM reference_documents rd
      LEFT JOIN reference_facts rf ON rf.reference_id = rd.id
      WHERE rd.brand_id = ? AND rd.deleted_at IS NOT NULL
      ORDER BY rd.deleted_at DESC
    `).all(brandId)
  },
```

**Step 3: Add `softDelete` and `bulkSoftDelete` methods**

Add after `findDeleted`:

```javascript
  softDelete(id) {
    const db = getDb()
    db.prepare("UPDATE reference_documents SET deleted_at = datetime('now') WHERE id = ?").run(id)
  },

  bulkSoftDelete(ids) {
    const db = getDb()
    const placeholders = ids.map(() => '?').join(', ')
    db.prepare(
      `UPDATE reference_documents SET deleted_at = datetime('now') WHERE id IN (${placeholders})`
    ).run(...ids)
    return { updated: ids.length }
  },
```

**Step 4: Add `restore` and `bulkRestore` methods**

```javascript
  restore(id) {
    const db = getDb()
    db.prepare("UPDATE reference_documents SET deleted_at = NULL, folder_id = NULL WHERE id = ?").run(id)
  },

  bulkRestore(ids) {
    const db = getDb()
    const placeholders = ids.map(() => '?').join(', ')
    db.prepare(
      `UPDATE reference_documents SET deleted_at = NULL, folder_id = NULL WHERE id IN (${placeholders})`
    ).run(...ids)
    return { restored: ids.length }
  },
```

**Step 5: Rename `delete` to `permanentDelete` and add `bulkPermanentDelete`**

Rename existing `delete(id)` method to `permanentDelete(id)`. No other changes to the method body.

Add below it:

```javascript
  bulkPermanentDelete(ids) {
    const db = getDb()
    const placeholders = ids.map(() => '?').join(', ')
    const refs = db.prepare(
      `SELECT file_path FROM reference_documents WHERE id IN (${placeholders})`
    ).all(...ids)
    db.prepare(
      `DELETE FROM reference_documents WHERE id IN (${placeholders})`
    ).run(...ids)
    return { deleted: ids.length, filePaths: refs.map(r => r.file_path).filter(Boolean) }
  }
```

Remove the old `bulkDelete` method entirely (replaced by `bulkSoftDelete` and `bulkPermanentDelete`).

**Step 6: Commit**

```bash
git add backend/src/models/Reference.js
git commit -m "feat: add soft delete, restore, and permanent delete model methods"
```

---

### Task 3: Controller & Routes — Trash Endpoints

**Files:**
- Modify: `backend/src/controllers/referenceController.js`
- Modify: `backend/src/routes/references.js`

**Step 1: Update `delete` controller to soft-delete**

In `referenceController.delete` (line 94-109), replace the body:

```javascript
  delete(req, res, next) {
    try {
      const existing = Reference.findById(req.params.refId)
      if (!existing) throw new AppError('Reference not found', 404)
      Reference.softDelete(req.params.refId)
      res.json({ message: 'Reference moved to trash' })
    } catch (err) {
      next(err)
    }
  },
```

**Step 2: Update `bulkDelete` controller to soft-delete**

In `referenceController.bulkDelete` (line 127-144), replace the body:

```javascript
  bulkDelete(req, res, next) {
    try {
      const { ids } = req.body
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new AppError('ids must be a non-empty array', 400)
      }
      Reference.bulkSoftDelete(ids)
      res.json({ message: `${ids.length} references moved to trash` })
    } catch (err) {
      next(err)
    }
  },
```

**Step 3: Add `listTrash`, `restore`, and `permanentDelete` controller methods**

Add these after `bulkDelete`:

```javascript
  listTrash(req, res, next) {
    try {
      const brandId = parseInt(req.params.brandId, 10)
      const brand = Brand.findById(brandId)
      if (!brand) throw new AppError('Brand not found', 404)
      const references = Reference.findDeleted(brandId)
      res.json({ references })
    } catch (err) {
      next(err)
    }
  },

  restore(req, res, next) {
    try {
      const { ids } = req.body
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new AppError('ids must be a non-empty array', 400)
      }
      Reference.bulkRestore(ids)
      res.json({ message: `${ids.length} references restored`, restored: ids.length })
    } catch (err) {
      next(err)
    }
  },

  permanentDelete(req, res, next) {
    try {
      const { ids } = req.body
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new AppError('ids must be a non-empty array', 400)
      }
      const { deleted, filePaths } = Reference.bulkPermanentDelete(ids)
      for (const filePath of filePaths) {
        const fullPath = path.resolve(filePath)
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath)
        }
      }
      res.json({ message: `${deleted} references permanently deleted` })
    } catch (err) {
      next(err)
    }
  }
```

**Step 4: Add routes**

In `backend/src/routes/references.js`, add before the existing routes (order matters — specific paths before parameterized):

```javascript
router.get('/trash', referenceController.listTrash)
router.post('/restore', referenceController.restore)
router.delete('/permanent', referenceController.permanentDelete)
```

These must go ABOVE the `router.get('/:refId', ...)` line so they don't get matched as a `:refId` param.

**Step 5: Verify backend compiles**

```bash
cd /Users/wallymo/claims_detector/backend && npm run dev
```

Expected: Server starts without errors.

**Step 6: Quick manual test**

```bash
# Soft delete a reference (use any valid ref ID — we'll restore it right after)
curl -s -X DELETE http://localhost:3001/api/brands/1/references/1 | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d)))"

# Check trash
curl -s http://localhost:3001/api/brands/1/references/trash | node -e "process.stdin.on('data',d=>console.log('Trash count:',JSON.parse(d).references.length))"

# Restore it
curl -s -X POST http://localhost:3001/api/brands/1/references/restore -H 'Content-Type: application/json' -d '{"ids":[1]}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d)))"

# Verify it's back in main list
curl -s http://localhost:3001/api/brands/1/references | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d).references;console.log('Active refs:',r.length);console.log('Ref 1 present:',r.some(x=>x.id===1))})"
```

**Step 7: Commit**

```bash
git add backend/src/controllers/referenceController.js backend/src/routes/references.js
git commit -m "feat: add trash, restore, and permanent delete endpoints"
```

---

### Task 4: Frontend API Client

**Files:**
- Modify: `app/src/services/api.js`

**Step 1: Add trash, restore, and permanent delete functions**

Add in the `// ========== Bulk Reference Operations ==========` section, after `bulkDeleteReferences`:

```javascript
export async function fetchTrash(brandId) {
  const data = await request(`/brands/${brandId}/references/trash`)
  return data.references
}

export async function restoreReferences(brandId, ids) {
  return request(`/brands/${brandId}/references/restore`, {
    method: 'POST',
    body: JSON.stringify({ ids })
  })
}

export async function permanentDeleteReferences(brandId, ids) {
  return request(`/brands/${brandId}/references/permanent`, {
    method: 'DELETE',
    body: JSON.stringify({ ids })
  })
}
```

**Step 2: Commit**

```bash
git add app/src/services/api.js
git commit -m "feat: add trash, restore, and permanent delete API functions"
```

---

### Task 5: MKG2ClaimsDetector — State & Handlers

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx`

**Step 1: Add trash state**

Near the existing `referenceDocuments` state (search for `useState([])`), add:

```javascript
const [trashDocuments, setTrashDocuments] = useState([])
```

**Step 2: Load trash alongside references**

In `loadReferences(brandId)` function (around line 214), after the existing `fetchReferences` call completes and `setReferenceDocuments` is called, add a parallel trash fetch. Add inside the `try` block, after `setReferenceDocuments(...)`:

```javascript
      // Also load trash for the badge count
      try {
        const trashRefs = await api.fetchTrash(brandId)
        setTrashDocuments(trashRefs.map(ref => ({
          id: ref.id,
          name: ref.display_alias,
          originalName: ref.filename
            ? ref.filename
                .replace(/^\d+_/, '')
                .replace(/\.[^.]+$/, '')
                .replace(/_/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase())
            : ref.display_alias,
          size: formatFileSize(ref.file_size_bytes),
          uploadedAt: new Date(ref.upload_date).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
          }),
          deletedAt: ref.deleted_at,
          doc_type: ref.doc_type,
          has_content: ref.has_content,
          page_count: ref.page_count,
          brand_id: ref.brand_id,
          folder_id: ref.folder_id || null,
          extraction_status: ref.extraction_status || null,
          facts_count: ref.facts_count || 0
        })))
      } catch (err) {
        // Trash fetch is non-critical — don't block the library
        console.warn('Failed to load trash:', err)
      }
```

**Step 3: Update existing delete handler to refresh trash**

The current `handleReferenceDelete` already does a soft delete (backend changed). But we need to also update `trashDocuments` locally. Find the existing single-delete handler. It may be inline or in `handleBulkDelete`. The bulk handler (line 732) does:

```javascript
  const handleBulkDelete = async (ids) => {
    try {
      await api.bulkDeleteReferences(ids)
      setReferenceDocuments(prev => prev.filter(doc => !ids.includes(doc.id)))
    } catch (err) {
      logger.error('Bulk delete error:', err)
    }
  }
```

Update it to move items to trash state:

```javascript
  const handleBulkDelete = async (ids) => {
    try {
      await api.bulkDeleteReferences(ids)
      const deleted = referenceDocuments.filter(doc => ids.includes(doc.id))
      setReferenceDocuments(prev => prev.filter(doc => !ids.includes(doc.id)))
      setTrashDocuments(prev => [...deleted.map(d => ({ ...d, deletedAt: new Date().toISOString() })), ...prev])
    } catch (err) {
      logger.error('Bulk delete error:', err)
    }
  }
```

Also find `handleReferenceDelete` (passed as `onDelete` to LibraryTab around line 1209). It likely calls `deleteReference` for a single ref. Update it similarly:

```javascript
  const handleReferenceDelete = async (refId) => {
    try {
      await api.deleteReference(libraryBrandId || selectedBrandId, refId)
      const deleted = referenceDocuments.find(doc => doc.id === refId)
      setReferenceDocuments(prev => prev.filter(doc => doc.id !== refId))
      if (deleted) {
        setTrashDocuments(prev => [{ ...deleted, deletedAt: new Date().toISOString() }, ...prev])
      }
    } catch (err) {
      logger.error('Delete reference error:', err)
    }
  }
```

**Step 4: Add restore and permanent delete handlers**

Add after the delete handlers:

```javascript
  const handleRestore = async (ids) => {
    try {
      const brandId = libraryBrandId || selectedBrandId
      await api.restoreReferences(brandId, ids)
      const restored = trashDocuments.filter(doc => ids.includes(doc.id))
      setTrashDocuments(prev => prev.filter(doc => !ids.includes(doc.id)))
      setReferenceDocuments(prev => [...prev, ...restored.map(d => ({ ...d, deletedAt: undefined, folder_id: null }))])
    } catch (err) {
      logger.error('Restore error:', err)
    }
  }

  const handlePermanentDelete = async (ids) => {
    try {
      const brandId = libraryBrandId || selectedBrandId
      await api.permanentDeleteReferences(brandId, ids)
      setTrashDocuments(prev => prev.filter(doc => !ids.includes(doc.id)))
    } catch (err) {
      logger.error('Permanent delete error:', err)
    }
  }
```

**Step 5: Pass new props to LibraryTab**

Update the `<LibraryTab>` JSX (around line 1198) to add the new props:

```jsx
                <LibraryTab
                  documents={referenceDocuments}
                  trashDocuments={trashDocuments}
                  folders={folders}
                  activeFolderId={activeFolderId}
                  selectedBrand={selectedBrand}
                  onFolderSelect={setActiveFolderId}
                  onFolderCreate={handleFolderCreate}
                  onFolderDelete={handleFolderDelete}
                  onFolderRename={handleFolderRename}
                  onUpload={handleReferenceUpload}
                  onRename={handleReferenceRename}
                  onDelete={handleReferenceDelete}
                  onBulkDelete={handleBulkDelete}
                  onBulkMove={handleBulkMove}
                  onRestore={handleRestore}
                  onPermanentDelete={handlePermanentDelete}
                  onView={(refId) => setReferenceViewerData({ referenceId: refId })}
                  onRetryIndex={handleRetryIndex}
                  isLoading={isLoadingLibrary}
                  isUploading={isUploadingRef}
                />
```

**Step 6: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx
git commit -m "feat: add trash state, restore, and permanent delete handlers"
```

---

### Task 6: LibraryTab — Trash Folder & Mode Switching

**Files:**
- Modify: `app/src/components/claims-detector/LibraryTab.jsx`
- Modify: `app/src/components/claims-detector/LibraryTab.module.css`

**Step 1: Accept new props**

Update the component signature to accept:

```javascript
export default function LibraryTab({
  documents = [],
  trashDocuments = [],
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
  onRestore,
  onPermanentDelete,
  onView,
  onRetryIndex,
  isLoading = false,
  isUploading = false
}) {
```

**Step 2: Derive trash mode from `activeFolderId`**

Add near the top of the component:

```javascript
  const isTrashMode = activeFolderId === '__trash__'
```

**Step 3: Update `filteredDocs` to handle trash mode**

Replace the existing `filteredDocs` line:

```javascript
  const filteredDocs = activeFolderId
    ? documents.filter(d => d.folder_id === activeFolderId)
    : documents
```

with:

```javascript
  const filteredDocs = isTrashMode
    ? trashDocuments
    : activeFolderId
      ? documents.filter(d => d.folder_id === activeFolderId)
      : documents
```

**Step 4: Add Trash entry to folder tree**

After the closing `</div>` of `treeChildren` (the child folders section, around line 294), and before the closing `</div>` of `folderTree`, add the Trash entry:

```jsx
          {/* Trash */}
          {trashDocuments.length > 0 && (
            <button
              className={`${styles.trashItem} ${isTrashMode ? styles.trashItemActive : ''}`}
              onClick={() => onFolderSelect?.('__trash__')}
            >
              <span className={styles.trashIcon}>
                <Icon name="trash" size={16} />
              </span>
              <span className={styles.trashLabel}>Trash</span>
              <span className={styles.trashCount}>{trashDocuments.length}</span>
            </button>
          )}
```

**Step 5: Update bulk action bar for trash mode**

Replace the existing bulk bar content (lines 298-415) with a conditional:

```jsx
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
                {isTrashMode ? (
                  <>
                    <button className={styles.restoreBtn} onClick={() => onRestore?.(Array.from(selectedIds))}>
                      <Icon name="refreshCw" size={14} />
                      Restore
                    </button>
                    <button
                      className={styles.bulkDeleteBtn}
                      onClick={() => {
                        if (window.confirm(`Permanently delete ${selectedIds.size} document${selectedIds.size > 1 ? 's' : ''}? This cannot be undone.`)) {
                          onPermanentDelete?.(Array.from(selectedIds))
                          clearSelection()
                        }
                      }}
                    >
                      <Icon name="x" size={14} />
                      Delete Forever
                    </button>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
          )}
```

**Step 6: Hide upload button and folder tree actions in trash mode**

In the header section, hide the upload button when in trash mode. Replace the header block:

```jsx
          <div className={styles.libraryHeader}>
            <span className={styles.libraryCount}>
              {isTrashMode ? `${filteredDocs.length} in trash` : `${filteredDocs.length} documents`}
            </span>
            <div className={styles.headerActions}>
              {!isTrashMode && (
                <>
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
                </>
              )}
            </div>
          </div>
```

**Step 7: Pass `isTrashMode` to ReferenceListItem**

Update the document list rendering. In the `filteredDocs.map` section (around line 440), add `isTrashMode` and trash-specific handlers:

```jsx
        <div className={styles.libraryList}>
          {filteredDocs.map((doc) => (
            <ReferenceListItem
              key={doc.id}
              document={doc}
              selected={selectedIds.has(doc.id)}
              onSelect={toggleSelect}
              onView={onView}
              onRename={isTrashMode ? undefined : (newName) => onRename?.(doc.id, newName)}
              onDelete={isTrashMode ? undefined : () => onDelete?.(doc.id)}
              onRetryIndex={isTrashMode ? undefined : () => onRetryIndex?.(doc.id)}
              isTrashMode={isTrashMode}
              onRestore={isTrashMode ? () => onRestore?.([doc.id]) : undefined}
              onPermanentDelete={isTrashMode ? () => {
                if (window.confirm(`Permanently delete "${doc.name}"? This cannot be undone.`)) {
                  onPermanentDelete?.([doc.id])
                }
              } : undefined}
            />
          ))}
        </div>
```

**Step 8: Update empty state for trash**

In the empty state section, add a trash-specific empty state. After the `filteredDocs.length === 0` check, the existing empty state says "No References for {brand}". This is fine — when trash is empty it won't be visible in the tree, so users can't navigate to an empty trash view.

**Step 9: Add CSS for Trash tree item and restore button**

Add to `LibraryTab.module.css`:

```css
/* ===== Trash item in folder tree ===== */
.trashItem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px;
  margin-top: 8px;
  border: none;
  border-top: var(--border-width-thin) solid var(--color-border-default);
  background: transparent;
  cursor: pointer;
  border-radius: 0;
  width: 100%;
  text-align: left;
  transition: background 0.15s ease;
}

.trashItem:hover {
  background: var(--color-background-secondary, #f5f5f5);
}

.trashItemActive {
  background: var(--red-1, #FFEBEE);
}

.trashIcon {
  display: flex;
  align-items: center;
  color: var(--color-text-disabled, #9e9e9e);
}

.trashItemActive .trashIcon {
  color: var(--red-6, #E53935);
}

.trashLabel {
  flex: 1;
  font-size: var(--font-size-sm, 14px);
  color: var(--color-text-secondary, #616161);
}

.trashItemActive .trashLabel {
  color: var(--red-7, #D32F2F);
  font-weight: var(--font-weight-medium, 500);
}

.trashCount {
  font-size: 11px;
  color: var(--color-text-disabled, #9e9e9e);
  background: var(--color-background-secondary, #f5f5f5);
  padding: 1px 6px;
  border-radius: 10px;
}

.trashItemActive .trashCount {
  color: var(--red-6, #E53935);
  background: var(--red-2, #FFCDD2);
}

/* ===== Restore button in bulk bar ===== */
.restoreBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: var(--border-width-thin) solid var(--green-5, #4CAF50);
  border-radius: var(--border-radius-sm);
  background: var(--color-background-primary);
  color: var(--green-7, #388E3C);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all 0.15s ease;
}

.restoreBtn:hover {
  background: var(--green-1, #E8F5E9);
}
```

**Step 10: Commit**

```bash
git add app/src/components/claims-detector/LibraryTab.jsx app/src/components/claims-detector/LibraryTab.module.css
git commit -m "feat: add Trash folder entry and trash-mode bulk actions in LibraryTab"
```

---

### Task 7: ReferenceListItem — Trash Mode Actions

**Files:**
- Modify: `app/src/components/claims-detector/ReferenceListItem.jsx`
- Modify: `app/src/components/claims-detector/ReferenceListItem.module.css`

**Step 1: Accept new props**

Update component signature:

```javascript
export default function ReferenceListItem({
  document,
  onRename,
  onDelete,
  onView,
  onRetryIndex,
  selected,
  onSelect,
  isTrashMode = false,
  onRestore,
  onPermanentDelete
}) {
```

**Step 2: Disable editing in trash mode**

Replace the `handleStartEdit` call on the name span. In trash mode, clicking the name should do nothing (no rename). Update the name display section:

In the `nameRow` section, change:

```jsx
              <span
                className={styles.itemName}
                onClick={handleStartEdit}
                title="Click to rename"
              >{document.name}</span>
```

to:

```jsx
              <span
                className={isTrashMode ? styles.itemNameDisabled : styles.itemName}
                onClick={isTrashMode ? undefined : handleStartEdit}
                title={isTrashMode ? undefined : "Click to rename"}
              >{document.name}</span>
```

**Step 3: Replace action buttons in trash mode**

Replace the delete button section (the `{!isEditing && (` block at the end) with:

```jsx
      {!isEditing && (
        isTrashMode ? (
          <div className={styles.trashActions}>
            <button
              className={styles.restoreBtn}
              onClick={(e) => { e.stopPropagation(); onRestore?.() }}
              title="Restore to library"
            >
              <Icon name="refreshCw" size={14} />
            </button>
            <button
              className={styles.permanentDeleteBtn}
              onClick={(e) => { e.stopPropagation(); onPermanentDelete?.() }}
              title="Delete forever"
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        ) : (
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
        )
      )}
```

**Step 4: Add CSS for trash mode**

Add to `ReferenceListItem.module.css`:

```css
.itemNameDisabled {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 1px 4px;
  margin: -1px -4px;
}

.trashActions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.restoreBtn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--green-6, #43A047);
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  transition: all 0.15s ease;
}

.restoreBtn:hover {
  background: var(--green-1, #E8F5E9);
  color: var(--green-7, #388E3C);
}

.permanentDeleteBtn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--color-text-disabled, #9e9e9e);
  cursor: pointer;
  border-radius: var(--border-radius-sm);
  transition: all 0.15s ease;
}

.permanentDeleteBtn:hover {
  color: var(--red-7, #D32F2F);
  background: var(--red-1, #FFEBEE);
}

.listItem:hover .restoreBtn,
.listItem:hover .permanentDeleteBtn {
  display: flex;
}
```

**Step 5: Commit**

```bash
git add app/src/components/claims-detector/ReferenceListItem.jsx app/src/components/claims-detector/ReferenceListItem.module.css
git commit -m "feat: add restore and permanent delete actions to ReferenceListItem"
```

---

### Task 8: Verify Build & End-to-End Test

**Step 1: Verify frontend builds**

```bash
cd /Users/wallymo/claims_detector/app && npm run build
```

Expected: Build succeeds (500KB chunk warning is expected).

**Step 2: Manual end-to-end test**

Open http://localhost:5173/mkg2, select a brand, go to Library tab:

1. Select a reference → click Delete → confirm
2. Reference disappears from main list
3. "Trash (1)" appears at bottom of folder tree
4. Click Trash → deleted reference appears with restore/delete-forever buttons
5. Click Restore on the reference → it moves back to All Files
6. Trash entry disappears (count = 0)
7. Repeat: delete a ref, go to Trash, click Delete Forever → confirm → permanently removed
8. Bulk: select multiple refs → Delete → go to Trash → select all → Restore
9. Bulk: select in Trash → Delete Forever → confirm → permanently gone

**Step 3: Verify detection still works**

After restoring refs, run a claim detection to make sure nothing broke in the pipeline.

---

## Execution Order

| Task | Type | Depends On | Files |
|------|------|-----------|-------|
| 1. Migration | DB | None | `backend/migrations/004_soft_delete.sql` |
| 2. Model | Backend | Task 1 | `backend/src/models/Reference.js` |
| 3. Controller & Routes | Backend | Task 2 | `referenceController.js`, `references.js` |
| 4. API Client | Frontend | Task 3 | `app/src/services/api.js` |
| 5. State & Handlers | Frontend | Task 4 | `MKG2ClaimsDetector.jsx` |
| 6. LibraryTab | Frontend | Task 5 | `LibraryTab.jsx`, `LibraryTab.module.css` |
| 7. ReferenceListItem | Frontend | Task 6 | `ReferenceListItem.jsx`, `ReferenceListItem.module.css` |
| 8. Build & Test | Verify | All | — |
